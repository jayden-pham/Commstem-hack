from flask import Blueprint, jsonify, send_file, send_from_directory, abort
import os
from services.storage import read_path_by_id

images_bp = Blueprint("images", __name__)

@images_bp.get("/images/<int:image_id>")
def get_image(image_id: int):
    path = read_path_by_id(image_id)
    if not path:
        return jsonify({"error": "not found"}), 404
    # Resolve relative DB paths like "server/storage/..." to absolute
    abs_path = path
    if not os.path.isabs(abs_path):
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        abs_path = os.path.join(project_root, path)
    if not os.path.exists(abs_path):
        return jsonify({"error": "not found"}), 404
    return send_file(abs_path, mimetype="image/png", as_attachment=False)

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STORAGE_DIR = os.path.join(BASE, "storage")  # <root>/server/storage

@images_bp.get("/server/storage/<path:subpath>")
def serve_storage(subpath: str):
    # simple path normalisation to avoid '..'
    norm = os.path.normpath(subpath)
    if norm.startswith(".."):
        abort(404)
    return send_from_directory(STORAGE_DIR, norm)
