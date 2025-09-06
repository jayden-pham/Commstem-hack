import os
from db import db

BASE = os.path.abspath(os.path.dirname(__file__) + "/..")
IMAGES_DIR = os.path.join(BASE, "storage", "images")

def _path_for_id(image_id: int) -> str:
    return os.path.join(IMAGES_DIR, f"{image_id}.png")

def save_bytes_as_id(img_bytes: bytes) -> tuple[int, str]:
    with db() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO images(path) VALUES ('')")  # reserve ID
        image_id = cur.lastrowid
        path = _path_for_id(image_id)
        with open(path, "wb") as f:
            f.write(img_bytes)
        cur.execute("UPDATE images SET path=? WHERE id=?", (path, image_id))
        conn.commit()
    return image_id, f"/images/{image_id}"

def read_path_by_id(image_id: int) -> str | None:
    with db() as conn:
        row = conn.execute("SELECT path FROM images WHERE id=?", (image_id,)).fetchone()
        return row["path"] if row else None
