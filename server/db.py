import os, sqlite3

BASE = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE, "storage", "app.db")

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as conn:
        c = conn.cursor()
        c.execute("""CREATE TABLE IF NOT EXISTS images(
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS conversations(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT 'Untitled',
            current_image_id INTEGER NOT NULL
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS messages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL,     -- 'user' | 'assistant'
            kind TEXT NOT NULL,     -- 'edit' | 'generation' | 'selection' | 'text'
            content TEXT NOT NULL,  -- JSON string
            created_at TEXT NOT NULL
        )""")
        conn.commit()
