import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import Database from "better-sqlite3";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename);
const app=express();
const dbPath=process.env.DB_PATH || path.join(__dirname,"data.sqlite");
const db=new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,
 premium_until TEXT,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage(
 user_id TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,day)
);
CREATE TABLE IF NOT EXISTS payments(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL,email TEXT NOT NULL,method TEXT NOT NULL,
 transaction_id TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,
 created_at TEXT NOT NULL,reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
`);

const port=Number(process.env.PORT||3000);
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const DAY=86400000;
const now=()=>Date.now(), today=()=>new Date().toISOString().slice(0,10);
const uid=()=>crypto.randomBytes(18).toString("hex");
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
const safeEqual=(a,b)=>{const A=Buffer.from(a),B=Buffer.from(b);return A.length===B.length&&crypto.timingSafeEqual(A,B)};
const hashPassword=p=>new Promise((resolve,reject)=>{
 const salt=crypto.randomBytes(16);
 crypto.scrypt(p,salt,64,{N:16384,r:8,p:1},(e,d)=>e?reject(e):resolve(salt.toString("hex")+":"+d.toString("hex")));
});
const verifyPassword=(p,stored)=>new Promise(resolve=>{
 const [salt,key]=stored.split(":");
 crypto.scrypt(p,Buffer.from(salt,"hex"),64,{N:16384,r:8,p:1},(e,d)=>resolve(!e&&safeEqual(d.toString("hex"),key)));
});
const premium=u=>!!u?.premium_until&&new Date(u.premium_until).getTime()>now();
const limit=u=>premium(u)?Number(process.env.PREMIUM_DAILY_LIMIT||100):Number(process.env.FREE_DAILY_LIMIT||5);
const userPublic=u=>({id:u.id,email:u.email,premiumUntil:u.premium_until||null});
const getUser=id=>db.prepare("SELECT * FROM users WHERE id=?").get(id);
const setUsage=db.prepare(`INSERT INTO usage(user_id,day,count) VALUES(?,?,1)
 ON CONFLICT(user_id,day) DO UPDATE SET count=count+1`);
const getUsage=u=>db.prepare("SELECT count FROM usage WHERE user_id=? AND day=?").get(u.id,today())?.count||0;

async function ensureAdmin(){
 const email=(process.env.ADMIN_EMAIL||"admin@example.com").trim().toLowerCase();
 if(getUser("admin")) return;
 const hash=await hashPassword(process.env.ADMIN_PASSWORD||"CHANGE_THIS_NOW");
 db.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)")
 .run("admin",email,hash,new Date().toISOString());
}
function sessionUser(req){
 const raw=req.cookies?.baw_session;if(!raw)return null;
 const s=db.prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?").get(sha(raw),now());
 return s?getUser(s.user_id):null;
}
function auth(req,res,next){const u=sessionUser(req);if(!u)return res.status(401).json({error:"Login required"});req.user=u;next()}
function admin(req,res,next){if(req.user?.id!=="admin")return res.status(403).json({error:"Admin only"});next()}
function csrf(req,res,next){
 if(["GET","HEAD","OPTIONS"].includes(req.method)) return next();
 const a=req.get("x-csrf-token"),b=req.cookies?.baw_csrf;
 if(!a||!b||!safeEqual(a,b))return res.status(403).json({error:"CSRF validation failed"});
 next();
}
const buckets=new Map();
function rate(req,res,next){
 const k=(req.ip||"unknown")+":"+req.path, t=now(), x=buckets.get(k);
 if(!x||t-x.t>60000)buckets.set(k,{t,n:1});
 else if(++x.n>60)return res.status(429).json({error:"Too many requests. Try again later."});
 next();
}

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({limit:"100kb"}));
app.use(cookieParser());
app.get("/health",(req,res)=>res.json({ok:true,service:"bangla-ai-writer"}));
app.use(rate);
app.use((req,res,next)=>{
 res.cookie("baw_csrf",req.cookies.baw_csrf||uid(),{httpOnly:false,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:DAY*30});
 next();
});
app.use(csrf);

app.post("/api/auth/register",async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(), p=String(req.body.password||"");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||p.length<8)return res.status(400).json({error:"Valid email এবং কমপক্ষে ৮ অক্ষরের password দিন।"});
 if(db.prepare("SELECT 1 FROM users WHERE email=?").get(email))return res.status(409).json({error:"এই email আগে থেকেই আছে।"});
 const u={id:uid(),email,password_hash:await hashPassword(p),created_at:new Date().toISOString()};
 db.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)").run(u.id,u.email,u.password_hash,u.created_at);
 loginCookie(res,u.id);res.json({user:userPublic(u)});
});
app.post("/api/auth/login",async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(),p=String(req.body.password||"");
 const u=db.prepare("SELECT * FROM users WHERE email=?").get(email);
 if(!u||!(await verifyPassword(p,u.password_hash)))return res.status(401).json({error:"Email বা password ভুল।"});
 loginCookie(res,u.id);res.json({user:userPublic(u)});
});
function loginCookie(res,userId){
 const raw=uid()+uid();db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(sha(raw),userId,now()+DAY*30);
 res.cookie("baw_session",raw,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:DAY*30});
}
app.post("/api/auth/logout",auth,(req,res)=>{
 const raw=req.cookies.baw_session;if(raw)db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha(raw));
 res.clearCookie("baw_session");res.json({ok:true});
});
app.get("/api/me",auth,(req,res)=>res.json({user:userPublic(req.user),premium:premium(req.user),usage:getUsage(req.user),limit:limit(req.user),plans:{price:Number(process.env.PREMIUM_PRICE||199),days:Number(process.env.PREMIUM_DAYS||30)}}));

app.post("/api/auth/change-password",auth,async(req,res)=>{
 const old=String(req.body.oldPassword||""),p=String(req.body.newPassword||"");
 if(p.length<8||!(await verifyPassword(old,req.user.password_hash)))return res.status(400).json({error:"পুরনো password ভুল অথবা নতুন password খুব ছোট।"});
 db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await hashPassword(p),req.user.id);res.json({ok:true});
});

app.post("/api/generate",auth,async(req,res)=>{
 const prompt=String(req.body.prompt||"").trim(),tone=String(req.body.tone||"Professional"),language=String(req.body.language||"Bangla");
 if(prompt.length<3||prompt.length>8000)return res.status(400).json({error:"Prompt 3–8000 characters-এর মধ্যে দিন।"});
 const used=getUsage(req.user);if(used>=limit(req.user))return res.status(429).json({error:"আজকের limit শেষ হয়েছে। Premium plan নিলে বেশি generation পাবেন।"});
 if(!process.env.MODEL_API_KEY)return res.status(503).json({error:"MODEL_API_KEY server-এ সেট করা হয়নি।"});
 try{
  const client=new OpenAI({baseURL:"https://api.meta.ai/v1",apiKey:process.env.MODEL_API_KEY});
  const r=await client.responses.create({model:"muse-spark-1.3",input:[
   {role:"system",content:`You are Bangla AI Writer. Produce original, useful content. Language: ${language}; tone: ${tone}. Do not facilitate fraud, scams, spam, illegal activity, impersonation, or deceptive marketing.`},
   {role:"user",content:prompt}
  ]});
  setUsage.run(req.user.id,today());
  res.json({text:r.output_text||"No output",usage:getUsage(req.user),limit:limit(req.user)});
 }catch(e){console.error(e);res.status(502).json({error:"AI service request failed. Please try again."});}
});

app.get("/api/payment-info",(req,res)=>res.json({bkashNumber:process.env.BKASH_NUMBER||"Not configured",nagadNumber:process.env.NAGAD_NUMBER||"Not configured",price:Number(process.env.PREMIUM_PRICE||199),days:Number(process.env.PREMIUM_DAYS||30)}));
app.post("/api/payments",auth,(req,res)=>{
 const method=String(req.body.method||"").toLowerCase(),trx=String(req.body.transactionId||"").trim().toUpperCase();
 if(!["bkash","nagad"].includes(method)||!/^[A-Z0-9-]{4,80}$/.test(trx))return res.status(400).json({error:"Valid payment method এবং Transaction ID দিন।"});
 if(db.prepare("SELECT 1 FROM payments WHERE transaction_id=?").get(trx))return res.status(409).json({error:"এই Transaction ID আগে submit করা হয়েছে।"});
 const pending=db.prepare("SELECT 1 FROM payments WHERE user_id=? AND status='pending'").get(req.user.id);
 if(pending)return res.status(409).json({error:"একটি payment ইতিমধ্যে pending আছে।"});
 db.prepare(`INSERT INTO payments(id,user_id,email,method,transaction_id,amount,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
 .run(uid(),req.user.id,req.user.email,method,trx,Number(process.env.PREMIUM_PRICE||199),"pending",new Date().toISOString());
 res.json({ok:true,message:"Payment submitted. Verification-এর পর Premium চালু হবে।"});
});
app.get("/api/payments/mine",auth,(req,res)=>res.json(db.prepare("SELECT method,transaction_id,amount,status,created_at,reviewed_at FROM payments WHERE user_id=? ORDER BY created_at DESC").all(req.user.id)));

app.get("/api/admin/stats",auth,admin,(req,res)=>res.json({
 users:db.prepare("SELECT COUNT(*) n FROM users WHERE id!='admin'").get().n,
 pending:db.prepare("SELECT COUNT(*) n FROM payments WHERE status='pending'").get().n,
 approved:db.prepare("SELECT COUNT(*) n FROM payments WHERE status='approved'").get().n
}));
app.get("/api/admin/payments",auth,admin,(req,res)=>res.json(db.prepare("SELECT * FROM payments ORDER BY created_at DESC").all()));
app.post("/api/admin/payments/:id",auth,admin,(req,res)=>{
 const p=db.prepare("SELECT * FROM payments WHERE id=?").get(req.params.id);if(!p)return res.status(404).json({error:"Not found"});
 const action=req.body.action;if(!["approve","reject"].includes(action))return res.status(400).json({error:"Invalid action"});
 if(p.status!=="pending")return res.status(409).json({error:"Already reviewed"});
 if(action==="approve"){
  const u=getUser(p.user_id),days=Number(process.env.PREMIUM_DAYS||30);
  const base=premium(u)?new Date(u.premium_until):new Date();base.setDate(base.getDate()+days);
  db.prepare("UPDATE users SET premium_until=? WHERE id=?").run(base.toISOString(),u.id);
 }
 db.prepare("UPDATE payments SET status=?,reviewed_at=? WHERE id=?").run(action==="approve"?"approved":"rejected",new Date().toISOString(),p.id);
 res.json({ok:true});
});
app.get("*splat",(req,res)=>res.sendFile(path.join(__dirname,"index.html")))
await ensureAdmin();
app.listen(port,"0.0.0.0",()=>console.log(`Bangla AI Writer listening on port ${port}`));
