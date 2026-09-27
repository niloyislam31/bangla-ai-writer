const $ = (id) => document.getElementById(id);

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
  return "";
}

async function api(url, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };

  if (opts.body && typeof opts.body !== "string") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }

  if (!["GET", "HEAD"].includes((opts.method || "GET").toUpperCase())) {
    opts.headers["x-csrf-token"] = getCookie("baw_csrf");
  }

  const res = await fetch(url, opts);
  let data = {};
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(data.error || "একটি সমস্যা হয়েছে।");
  }

  return data;
}

function show(id) {
  document.querySelectorAll("main > section").forEach(section => {
    section.classList.add("hide");
  });

  const section = $(id);
  if (section) section.classList.remove("hide");

  if (id === "home") loadMe();
  if (id === "premium") loadPaymentInfo();
  if (id === "admin") loadAdmin();
}

function toggleAuth() {
  const title = $("authTitle");
  const button = document.querySelector("#auth button.primary");
  const switchText = $("switch");

  if (title.textContent === "Login") {
    title.textContent = "Register";
    button.textContent = "Register";
    switchText.innerHTML =
      'আগে থেকেই account আছে? <a href="#" onclick="toggleAuth();return false;">Login</a>';
  } else {
    title.textContent = "Login";
    button.textContent = "Login";
    switchText.innerHTML =
      'নতুন account? <a href="#" onclick="toggleAuth();return false;">Register</a>';
  }
}

async function submitAuth() {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    alert("Email এবং Password দিন।");
    return;
  }

  const isRegister = $("authTitle").textContent === "Register";

  try {
    const data = await api(
      isRegister ? "/api/auth/register" : "/api/auth/login",
      {
        method: "POST",
        body: { email, password }
      }
    );

    alert(isRegister ? "Register সফল হয়েছে।" : "Login সফল হয়েছে।");

    $("email").value = "";
    $("password").value = "";

    await loadMe();
    show("home");
  } catch (err) {
    alert(err.message);
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}

  $("adminNav").classList.add("hide");
  $("authNav").textContent = "Login";
  $("status").textContent = "Login করে শুরু করুন।";
  show("home");
}

async function loadMe() {
  try {
    const data = await api("/api/me");

    $("authNav").textContent = "Logout";
    $("authNav").onclick = logout;

    $("status").textContent =
      data.premium
        ? `Premium account • আজ ${data.usage}/${data.limit} generation ব্যবহার করেছেন।`
        : `Logged in • আজ ${data.usage}/${data.limit} generation ব্যবহার করেছেন।`;

    if (data.user && data.user.id === "admin") {
      $("adminNav").classList.remove("hide");
    } else {
      $("adminNav").classList.add("hide");
    }
  } catch {
    $("authNav").textContent = "Login";
    $("authNav").onclick = () => show("auth");
    $("status").textContent = "Login করে শুরু করুন।";
  }
}

async function generate() {
  const prompt = $("prompt").value.trim();

  if (prompt.length < 3) {
    alert("কমপক্ষে ৩ অক্ষরের লেখা দিন।");
    return;
  }

  const button = $("generate");
  button.disabled = true;
  button.textContent = "⏳ লেখা তৈরি হচ্ছে...";

  try {
    const data = await api("/api/generate", {
      method: "POST",
      body: {
        prompt,
        language: $("language").value,
        tone: $("tone").value
      }
    });

    $("result").textContent = data.text || "কোনো লেখা পাওয়া যায়নি।";
    $("resultCard").classList.remove("hide");

    $("status").textContent =
      `আজ ${data.usage}/${data.limit} generation ব্যবহার করেছেন।`;
  } catch (err) {
    if (err.message === "Login required") {
      alert("আগে Login করুন।");
      show("auth");
    } else {
      alert(err.message);
    }
  } finally {
    button.disabled = false;
    button.textContent = "✨ লেখা তৈরি করুন";
  }
}

async function loadPaymentInfo() {
  try {
    const data = await api("/api/payment-info");

    $("price").textContent = data.price;
    $("days").textContent = data.days;
    $("bkash").textContent = data.bkashNumber;
    $("nagad").textContent = data.nagadNumber;

    loadMyPayments();
  } catch (err) {
    alert(err.message);
  }
}

async function pay() {
  const method = $("method").value;
  const transactionId = $("trx").value.trim();

  if (!transactionId) {
    alert("Transaction ID দিন।");
    return;
  }

  try {
    const data = await api("/api/payments", {
      method: "POST",
      body: {
        method,
        transactionId
      }
    });

    alert(data.message || "Payment submitted হয়েছে।");
    $("trx").value = "";
    loadMyPayments();
  } catch (err) {
    alert(err.message);
  }
}

async function loadMyPayments() {
  const box = $("myPayments");

  try {
    const payments = await api("/api/payments/mine");

    if (!payments.length) {
      box.innerHTML = "<p class='muted'>এখনো কোনো payment submit করা হয়নি।</p>";
      return;
    }

    box.innerHTML =
      "<h3>আমার Payments</h3>" +
      payments.map(p => `
        <div class="card">
          <b>${escapeHtml(p.method)}</b>
          <p>Transaction ID: ${escapeHtml(p.transaction_id)}</p>
          <p>Amount: ${escapeHtml(p.amount)}৳</p>
          <p>Status: ${escapeHtml(p.status)}</p>
        </div>
      `).join("");
  } catch {}
}

async function loadAdmin() {
  try {
    const stats = await api("/api/admin/stats");

    $("stats").innerHTML = `
      <div class="card"><b>Users</b><h2>${stats.users}</h2></div>
      <div class="card"><b>Pending</b><h2>${stats.pending}</h2></div>
      <div class="card"><b>Approved</b><h2>${stats.approved}</h2></div>
    `;

    const payments = await api("/api/admin/payments");

    $("payments").innerHTML = payments.length
      ? payments.map(p => `
        <div class="card">
          <b>${escapeHtml(p.email)}</b>
          <p>Method: ${escapeHtml(p.method)}</p>
          <p>Transaction ID: ${escapeHtml(p.transaction_id)}</p>
          <p>Amount: ${escapeHtml(p.amount)}৳</p>
          <p>Status: ${escapeHtml(p.status)}</p>

          ${
            p.status === "pending"
              ? `
                <button onclick="reviewPayment('${p.id}','approve')">
                  Approve
                </button>
                <button onclick="reviewPayment('${p.id}','reject')">
                  Reject
                </button>
              `
              : ""
          }
        </div>
      `).join("")
      : "<p>কোনো payment নেই।";
  } catch (err) {
    alert(err.message);
    show("home");
  }
}

async function reviewPayment(id, action) {
  if (!confirm(
    action === "approve"
      ? "এই payment Approve করবেন?"
      : "এই payment Reject করবেন?"
  )) {
    return;
  }

  try {
    await api(`/api/admin/payments/${id}`, {
      method: "POST",
      body: { action }
    });

    alert("Payment update হয়েছে।");
    loadAdmin();
  } catch (err) {
    alert(err.message);
  }
}

function copyResult() {
  const text = $("result").textContent;

  navigator.clipboard.writeText(text)
    .then(() => alert("কপি হয়েছে।"))
    .catch(() => alert("কপি করা যায়নি।"));
}

function copy(id) {
  const text = $(id).textContent;

  navigator.clipboard.writeText(text)
    .then(() => alert("কপি হয়েছে।"))
    .catch(() => alert("কপি করা যায়নি।"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  $("generate").addEventListener("click", generate);
  loadMe();
});
