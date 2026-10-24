# 📝 Phone Notes

Text a Telegram bot from your phone and your notes go onto lists:

| You send | What happens |
|---|---|
| `#todo buy milk` | Adds "buy milk" to your **todo** list |
| `#idea podcast about bees` | Adds it to your **idea** list |
| `#books Dune` | No #books list yet? It gets created automatically |
| `#todo` | Shows your todo list, numbered |
| `#todo done 2` | Checks off item 2 (`done 1,3` works too) |
| `#todo delete 2` | Deletes item 2 |
| `#todo clear` | Removes checked-off items |
| `/lists` | Shows all your lists |
| `remember the thing` | No # at the start, so it goes to **#inbox** |

There's also a web page that shows all your lists, where you can check items off, delete them, or add new ones.

**How it fits together:** Telegram → Cloudflare Worker (this code) → Cloudflare D1 database. GitHub holds the code, and Cloudflare redeploys automatically whenever it changes. Everything runs on free plans.

---

## Setup (about 20–30 minutes)

### 1. Create your Telegram bot (2 min)
1. In Telegram, search for **@BotFather** (it has a blue checkmark) and open a chat.
2. Send `/newbot`. Pick a display name (e.g. *Gabe's Notes*), then a username that ends in `bot` (e.g. `gabe_notes_bot`).
3. BotFather replies with a **token** that looks like `123456789:AAH...`. Copy it somewhere safe. This is your `TELEGRAM_TOKEN`.

### 2. Make up your app password
Make up a long password using **only letters and numbers**, 20+ characters (for example from a password manager). This is your `APP_SECRET`. It protects your lists page and makes sure only Telegram can talk to your app.

### 3. Put the code on GitHub (5 min)
1. Sign in at [github.com](https://github.com) (make a free account if needed).
2. Click **+** (top right) → **New repository**. Name it `phone-notes`, choose **Private**, and click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Unzip `phone-notes.zip` on your computer, open the folder, select **everything inside it** (including the `src` folder), and drag it into the browser. Click **Commit changes**.

### 4. Create the database on Cloudflare (3 min)
1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (make a free account if needed).
2. In the left menu, go to **Storage & Databases → D1 SQL Database** and click **Create Database**.
3. Name it `phone-notes` and click **Create**.
4. On the database page, copy the **Database ID** (a long code like `a1b2c3d4-...`).
5. Back on GitHub, open `wrangler.toml` in your repo, click the ✏️ pencil icon, replace `PASTE-YOUR-DATABASE-ID-HERE` with your ID (keep the quotes), and click **Commit changes**.

### 5. Connect GitHub to Cloudflare and deploy (5 min)
1. In Cloudflare, go to **Compute (Workers) → Workers & Pages** and click **Create**.
2. Choose **Import a repository** and connect your GitHub account when asked. Give it access to the `phone-notes` repo.
3. Select `phone-notes`. Keep the project name as **phone-notes** and leave the other settings alone. Click **Create and deploy**.
4. Wait about a minute for the build to finish. You'll get an address like `https://phone-notes.YOUR-NAME.workers.dev`. That's your app.

### 6. Add your two secrets (2 min)
1. Open your **phone-notes** Worker → **Settings → Variables and Secrets** → **Add**.
2. Add `TELEGRAM_TOKEN`: set the type to **Secret** and paste the token from step 1.
3. Add `APP_SECRET`: set the type to **Secret** and paste the password from step 2.
4. Click **Deploy** to save.

### 7. Connect Telegram to your app (1 min)
Open this address in your browser, using your own app address and password:

```
https://phone-notes.YOUR-NAME.workers.dev/setup?key=YOUR_APP_SECRET
```

You should see **✅ All set!**

### 8. Try it
1. Open your bot in Telegram (search its username) and tap **Start**.
2. Send `#todo test`. It should reply that it created the list and added the note.
3. **The first chat that messages the bot becomes its owner.** Anyone else who finds the bot gets ignored.

### 9. Bookmark your lists page
Open `https://phone-notes.YOUR-NAME.workers.dev`, enter your `APP_SECRET`, and you'll stay signed in on that device. On iPhone, tap **Share → Add to Home Screen** to get an app-style icon.

---

## Making changes later
Edit any file on GitHub and commit. Cloudflare picks it up and redeploys within a minute or two. Your notes are kept in the database, so code changes never erase them.

## Troubleshooting
- **The bot doesn't reply:** open the `/setup?key=...` link again and read the message. Also check the Worker's **Logs** tab in Cloudflare.
- **The build failed on Cloudflare:** most likely the database ID in `wrangler.toml` is still the placeholder or has a typo.
- **"Wrong or missing key":** the `key=` in the address must match `APP_SECRET` exactly.
- **You need to move the bot to a different Telegram account:** in Cloudflare, go to **D1 → phone-notes → Console** and run `DELETE FROM settings WHERE key = 'owner_chat_id';`. The next person to message the bot becomes its owner.

## Adding a Siri Shortcut later
The app already accepts notes from the web page through `POST /api/command`, so an iPhone Shortcut can be added later to send notes by voice or with the Action button.
