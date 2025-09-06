import os
from db import db

BASE = os.path.abspath(os.path.dirname(__file__) + "/..")
STORAGE_BASE = os.path.join(BASE, "storage")
DIR_ORIGINALS = os.path.join(STORAGE_BASE, "originals")
DIR_MODIFIED  = os.path.join(STORAGE_BASE, "modified")
DIR_OUTPUTS   = os.path.join(STORAGE_BASE, "outputs")

os.makedirs(DIR_ORIGINALS, exist_ok=True)
os.makedirs(DIR_MODIFIED,  exist_ok=True)
os.makedirs(DIR_OUTPUTS,   exist_ok=True)

def _dir_for_kind(kind: str) -> str:
    if kind == "og":
        return DIR_ORIGINALS
    if kind == "mod":
        return DIR_MODIFIED
    if kind == "out":
        return DIR_OUTPUTS
    return DIR_OUTPUTS

def reserve_image_id() -> int:
    with db() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO images(path) VALUES ('')")
        image_id = cur.lastrowid
        conn.commit()
    return image_id

def write_reserved_image(image_id: int, conversation_id: int, edit_index: int, kind: str, img_bytes: bytes) -> tuple[int, str, str]:
    """
    Write bytes for an already-reserved image id into server/storage/<kind>/c{cid}_e{edit}_{kind}_id{image_id}.png
    Stores a RELATIVE path starting with "server/storage" in the DB, and returns (id, url, abs_path).
    """
    kind_dir = _dir_for_kind(kind)
    filename = f"c{conversation_id}_e{edit_index}_{kind}_id{image_id}.png"
    abs_path = os.path.join(kind_dir, filename)
    rel_path = os.path.join("server", "storage", os.path.basename(kind_dir), filename)
    with open(abs_path, "wb") as f:
        f.write(img_bytes)
    with db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE images SET path=? WHERE id=?", (rel_path, image_id))
        conn.commit()
    return image_id, f"/images/{image_id}", abs_path

def save_image_for_conversation(img_bytes: bytes, conversation_id: int, edit_index: int, kind: str) -> tuple[int, str, str]:
    image_id = reserve_image_id()
    return write_reserved_image(image_id, conversation_id, edit_index, kind, img_bytes)

def read_path_by_id(image_id: int) -> str | None:
    with db() as conn:
        row = conn.execute("SELECT path FROM images WHERE id=?", (image_id,)).fetchone()
        return row["path"] if row else None
