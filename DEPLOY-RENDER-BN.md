# Bangla AI Writer — Render HTTPS Deployment

## সবচেয়ে সহজ উপায়
1. এই project-এর `bangla-ai-writer-production` folder-এর files একটি private GitHub repository-তে upload করুন।
2. Render → New → Web Service → GitHub repo connect করুন।
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Health Check Path: `/health`
6. Environment variables-এ `MODEL_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `BKASH_NUMBER`, `NAGAD_NUMBER` দিন।
7. Deploy করুন। Render একটি HTTPS `onrender.com` address দেবে।

## গুরুত্বপূর্ণ
- Meta API key কখনো frontend বা APK-তে রাখবেন না।
- bKash/Nagad এখানে manual verification-এর জন্য; user Transaction ID submit করবে, admin approve করলে Premium চালু হবে।
- SQLite data `/var/data/data.sqlite`-এ রাখার জন্য persistent disk configured আছে।
- Render plan/feature availability আপনার account-এর বর্তমান pricing অনুযায়ী যাচাই করুন।

## Android
Deploy হওয়ার পর পাওয়া HTTPS URL-টি Android project's `MainActivity.java`-এর `webView.loadUrl(...)`-এ বসিয়ে APK build করুন।
