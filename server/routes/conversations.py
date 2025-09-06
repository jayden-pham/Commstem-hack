from flask import Blueprint, request, jsonify
from db import db
from services.storage import save_image_for_conversation, read_path_by_id
from services.model import generate_four_edits_from_two_bytes
from datetime import datetime
import json, os

conv_bp = Blueprint("conversations", __name__)

def now_iso():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

@conv_bp.post("/conversations")
def create_conversation():
    """
    Create from a base image (one call):
      multipart: image (file), optional title
    -> { id, title, current_image: {id, url} }
    """
    title = request.form.get("title") or "Untitled"
    file = request.files.get("image")
    if not file:
        return jsonify({"error":"image required"}), 400
    img_bytes = file.read()
    # Create conversation first to obtain cid
    with db() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO conversations(title, current_image_id) VALUES (?, 0)", (title,))
        cid = cur.lastrowid
        conn.commit()
    # Save the provided base image as originals, edit_index=0
    img_id, url, _ = save_image_for_conversation(img_bytes, cid, 0, "og")
    # Update conversation's current image
    with db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE conversations SET current_image_id=? WHERE id=?", (img_id, cid))
        conn.commit()
    return jsonify({"id": cid, "title": title, "current_image": {"id": img_id, "url": url}})

@conv_bp.post("/conversations/<int:cid>/edits")
def conversation_edits(cid: int):
    """
    Conversation-aware generation.
    multipart/form-data:
      - original (file, required)
      - modified (file, required)
      - prompt   (string, required)

    Behavior:
      - Saves original and modified images
      - Calls model to produce 4 variants (bytes)
      - Saves the 4 outputs
      - Logs two messages:
          1) role=user, kind=edit        {prompt, original_image_id, modified_image_id}
          2) role=assistant, kind=generation {outputs: [{image_id,url}*4]}
      - Returns JSON: { outputs: [{image_id,url}*4] }
    """
    prompt = (request.form.get("prompt") or "").strip()

    orig_fs = request.files.get("original")
    mod_fs  = request.files.get("modified")
    if not orig_fs or not mod_fs:
        return jsonify({"error": "both 'original' and 'modified' files are required"}), 400

    orig_bytes = orig_fs.read()
    mod_bytes  = mod_fs.read()

    # ensure conversation exists
    with db() as conn:
        conv = conn.execute("SELECT id FROM conversations WHERE id=?", (cid,)).fetchone()
        if not conv:
            return jsonify({"error": "conversation not found"}), 404

    # determine edit index from existing user 'edit' messages for this conversation
    with db() as conn:
        row = conn.execute("SELECT COUNT(1) AS n FROM messages WHERE conversation_id=? AND kind='edit'", (cid,)).fetchone()
        edit_index = int(row["n"]) + 1

    # save originals first with naming convention
    orig_id, _, _ = save_image_for_conversation(orig_bytes, cid, edit_index, "og")
    mod_id,  _, _ = save_image_for_conversation(mod_bytes,  cid, edit_index, "mod")
    # Fetch DB-stored paths for logging/response
    orig_path = read_path_by_id(orig_id)
    mod_path  = read_path_by_id(mod_id)

    # model returns saved Paths; read bytes and store them
    paths = generate_four_edits_from_two_bytes(mod_bytes, orig_bytes, prompt)
    outputs = []
    for p in paths:
        with open(p, "rb") as f:
            vb = f.read()
        out_id, _, _ = save_image_for_conversation(vb, cid, edit_index, "out")
        out_path = read_path_by_id(out_id)
        outputs.append({"image_id": out_id, "url": out_path})
        # remove intermediate model file to avoid leftover boxed_*_v*.png
        try:
            os.remove(p)
        except Exception:
            pass

    # log messages
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO messages(conversation_id, role, kind, content, created_at)
                VALUES (?, 'user', 'edit', ?, ?)""",
            (cid, json.dumps({
                "prompt": prompt,
                "original_image_id": orig_id,
                "original_url": orig_path,
                "modified_image_id": mod_id,
                "modified_url": mod_path,
            }), now_iso())
        )
        cur.execute(
            """INSERT INTO messages(conversation_id, role, kind, content, created_at)
                VALUES (?, 'assistant', 'generation', ?, ?)""",
            (cid, json.dumps({"outputs": outputs}), now_iso())
        )
        conn.commit()

    return jsonify({"outputs": outputs})

@conv_bp.post("/conversations/<int:cid>/select")
def select_variant(cid: int):
    data = request.get_json(force=True) or {}
    sel_id = data.get("selected_image_id")
    # allow deselect: if null/None/0/"" -> log deselection, do not change current image
    if not sel_id:
        with db() as conn:
            cur = conn.cursor()
            # verify conversation exists
            row = cur.execute("SELECT id, current_image_id FROM conversations WHERE id=?", (cid,)).fetchone()
            if not row:
                return jsonify({"error": "conversation not found"}), 404
            cur.execute(
                """INSERT INTO messages(conversation_id, role, kind, content, created_at)
                       VALUES (?, 'user', 'selection', ?, ?)""",
                (cid, json.dumps({"image_id": None}), now_iso())
            )
            conn.commit()
        return jsonify({"current_image": {"id": int(row["current_image_id"]), "url": f"/images/{int(row['current_image_id'])}"}, "selected": None})

    # selection
    try:
        sel_int = int(sel_id)
    except Exception:
        return jsonify({"error": "selected_image_id must be an integer"}), 400
    if not read_path_by_id(sel_int):
        return jsonify({"error":"image not found"}), 404
    with db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE conversations SET current_image_id=? WHERE id=?", (sel_int, cid))
        if cur.rowcount == 0:
            return jsonify({"error":"conversation not found"}), 404
        # track message
        cur.execute(
            """INSERT INTO messages(conversation_id, role, kind, content, created_at)
                   VALUES (?, 'user', 'selection', ?, ?)""",
            (cid, json.dumps({"image_id": sel_int}), now_iso())
        )
        conn.commit()
    return jsonify({"current_image": {"id": sel_int, "url": f"/images/{sel_int}"}, "selected": sel_int})


# -------------------------------------------------------------------------------------------------
# GET /conversations
# GET /conversations/<int:cid>
# PUT /conversations/<int:cid>
# -------------------------------------------------------------------------------------------------
@conv_bp.get("/conversations")
def list_conversations():
    with db() as conn:
        rows = conn.execute("SELECT id, title FROM conversations ORDER BY id DESC").fetchall()
    return jsonify([{"id": r["id"], "title": r["title"]} for r in rows])

@conv_bp.get("/conversations/<int:cid>")
def get_conversation(cid: int):
    with db() as conn:
        conv = conn.execute("SELECT id, title, current_image_id FROM conversations WHERE id=?", (cid,)).fetchone()
        if not conv:
            return jsonify({"error":"not found"}), 404
        msgs = conn.execute("SELECT role, kind, content, created_at FROM messages WHERE conversation_id=? ORDER BY id ASC", (cid,)).fetchall()
    # build current image url
    path = read_path_by_id(conv["current_image_id"])
    current = {"id": conv["current_image_id"], "url": f"/images/{conv['current_image_id']}"} if path else None
    messages = [{"role": m["role"], "kind": m["kind"], "content": json.loads(m["content"]), "created_at": m["created_at"]} for m in msgs]
    return jsonify({"id": conv["id"], "title": conv["title"], "current_image": current, "messages": messages})

@conv_bp.put("/conversations/<int:cid>")
def update_conversation(cid: int):
    data = request.get_json(force=True) or {}
    title = data.get("title")
    if not title:
        return jsonify({"error":"title required"}), 400
    with db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE conversations SET title=? WHERE id=?", (title, cid))
        if cur.rowcount == 0:
            return jsonify({"error":"not found"}), 404
        conn.commit()
    return jsonify({"ok": True})