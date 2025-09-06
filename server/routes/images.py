from flask import Blueprint, jsonify, send_file
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
