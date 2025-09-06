from flask import Blueprint, jsonify, send_file
import os
from services.storage import read_path_by_id

images_bp = Blueprint("images", __name__)

@images_bp.get("/images/<int:image_id>")
def get_image(image_id: int):
    path = read_path_by_id(image_id)
    if not path or not os.path.exists(path):
        return jsonify({"error": "not found"}), 404
    return send_file(path, mimetype="image/png", as_attachment=False)
