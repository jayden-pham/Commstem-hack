from flask import Flask
from flask_cors import CORS
import os

from db import init_db
from routes.edits import edits_bp
from routes.images import images_bp
from routes.conversations import conv_bp

def create_app():
    app = Flask(__name__)
    CORS(app)
    # ensure storage dirs
    base = os.path.abspath(os.path.dirname(__file__))
    os.makedirs(os.path.join(base, "storage", "images"), exist_ok=True)
    init_db()
    # routes
    app.register_blueprint(edits_bp)
    app.register_blueprint(images_bp)
    app.register_blueprint(conv_bp)
    return app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)


# import io, os, sqlite3
# from flask import Flask, request, jsonify, send_file
# from flask_cors import CORS
# from PIL import Image, ImageEnhance, ImageDraw, ImageFont

# BASE = os.path.abspath(os.path.dirname(__file__))
# STORAGE = os.path.join(BASE, "storage")
# IMAGES_DIR = os.path.join(STORAGE, "images")
# DB_PATH = os.path.join(STORAGE, "app.db")

# os.makedirs(IMAGES_DIR, exist_ok=True)

# app = Flask(__name__)
# CORS(app)

# # ---------------- DB ----------------

# def db():
#     conn = sqlite3.connect(DB_PATH)
#     conn.row_factory = sqlite3.Row
#     return conn

# def init_db():
#     with db() as conn:
#         conn.execute("""
#         CREATE TABLE IF NOT EXISTS images(
#           id   INTEGER PRIMARY KEY AUTOINCREMENT,
#           path TEXT NOT NULL
#         )""")
#         conn.commit()

# init_db()

# def _path_for_id(image_id: int) -> str:
#     return os.path.join(IMAGES_DIR, f"{image_id}.png")

# def save_bytes_as_id(img_bytes: bytes) -> tuple[int, str]:
#     """
#     Allocate an auto-increment ID, save to disk as <id>.png,
#     update DB with the final path, and return (id, url).
#     """
#     with db() as conn:
#         cur = conn.cursor()
#         # insert placeholder to get the ID
#         cur.execute("INSERT INTO images(path) VALUES (?)", ("",))
#         image_id = cur.lastrowid
#         # save to disk named by ID
#         path = _path_for_id(image_id)
#         with open(path, "wb") as f:
#             f.write(img_bytes)
#         # update row with real path
#         cur.execute("UPDATE images SET path=? WHERE id=?", (path, image_id))
#         conn.commit()
#     return image_id, f"/images/{image_id}"

# def read_path_by_id(image_id: int) -> str | None:
#     with db() as conn:
#         row = conn.execute("SELECT path FROM images WHERE id=?", (image_id,)).fetchone()
#         return row["path"] if row else None

# # ------------- Mock generator (replace with your model) -------------

# def make_four_variants(img_bytes: bytes, prompt: str) -> list[bytes]:
#     """
#     Synchronous placeholder. Replace with your inpainting/edit model call.
#     Always returns 4 PNG bytes.
#     """
#     base = Image.open(io.BytesIO(img_bytes)).convert("RGB")
#     w, h = base.size
#     outs = []
#     for i in range(4):
#         img = ImageEnhance.Color(base).enhance(0.85 + 0.15 * i)
#         img = ImageEnhance.Contrast(img).enhance(0.95 + 0.05 * i)
#         draw = ImageDraw.Draw(img)
#         try:
#             font = ImageFont.truetype("arial.ttf", size=max(14, w // 48))
#         except:
#             font = ImageFont.load_default()
#         label = f"v{i+1}: {prompt[:40]}{'…' if len(prompt) > 40 else ''}"
#         tw = draw.textlength(label, font=font)
#         draw.rectangle([8, 8, 16 + tw, 32], fill=(0, 0, 0, 160))
#         draw.text((12, 12), label, fill=(255, 255, 255), font=font)
#         buf = io.BytesIO()
#         img.save(buf, format="PNG")
#         outs.append(buf.getvalue())
#     return outs

# # ---------------- Routes ----------------

# @app.post("/edits")
# def edits():
#     """
#     Single-call inline image generation.
#     - Body: multipart/form-data with:
#         original  (file, required)  -- the original image
#         modified  (file, required)  -- the modified/masked working image
#         prompt (string, required)
#     - Stores all 4 generated outputs, filenames are <image_id>.png
#     - Response JSON: { outputs: [ {image_id, url}, x4 ] }
#     """
#     prompt = (request.form.get("prompt") or "").strip()
#     if not prompt:
#         return jsonify({"error": "prompt required"}), 400

#     original_up = request.files.get("original")
#     if not original_up:
#         return jsonify({"error": "original image file required"}), 400
#     modified_up = request.files.get("modified")
#     if not modified_up:
#         return jsonify({"error": "modified image file required"}), 400

#     original_bytes = original_up.read()
#     modified_bytes = modified_up.read()

#     # For now, we use the modified image for generation, but both are available.
#     variants = make_four_variants(modified_bytes, prompt)  # replace with real model

#     outputs = []
#     for vb in variants:
#         image_id, url = save_bytes_as_id(vb)
#         outputs.append({"image_id": image_id, "url": url})
#     return jsonify({"outputs": outputs})

# @app.get("/images/<int:image_id>")
# def get_image(image_id: int):
#     """
#     Serve a stored image by its numeric ID.
#     Files are named <id>.png on disk.
#     """
#     path = read_path_by_id(image_id)
#     if not path or not os.path.exists(path):
#         return jsonify({"error": "not found"}), 404
#     return send_file(path, mimetype="image/png", as_attachment=False)

# if __name__ == "__main__":
#     app.run(debug=True)
