from flask import Blueprint, request, jsonify
from services.model import generate_four_edits_from_two_bytes
from services.storage import save_bytes_as_id
from PIL import Image
import io

edits_bp = Blueprint("edits", __name__)

@edits_bp.post("/edits")
def edits():
    """
    Single-call generation using two images:
      - original (file, required) : original image (for validation/trace)
      - modified (file, required) : masked/working image used for generation
      - prompt   (string, required)

    Returns 4 stored variants: { outputs: [{image_id,url}, x4] }
    """
    prompt = (request.form.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "prompt required"}), 400

    orig_fs = request.files.get("original")
    mod_fs  = request.files.get("modified")
    if not orig_fs or not mod_fs:
        return jsonify({"error": "both 'original' and 'modified' files are required"}), 400

    orig_bytes = orig_fs.read()
    mod_bytes  = mod_fs.read()
    # sanity: same dimensions
    try:
        o = Image.open(io.BytesIO(orig_bytes)); m = Image.open(io.BytesIO(mod_bytes))
        if o.size != m.size:
            return jsonify({"error": "original and modified must share dimensions"}), 400
    except Exception as e:
        return jsonify({"error": f"invalid image(s): {e}"}), 400

    # Call two-image bytes API: expects (boxed_bytes=modified, base_bytes=original)
    # Returns saved output Paths; read and store into our images table.
    paths = generate_four_edits_from_two_bytes(mod_bytes, orig_bytes, prompt)
    outputs = []
    for p in paths:
        with open(p, "rb") as f:
            vb = f.read()
        image_id, url = save_bytes_as_id(vb)
        outputs.append({"image_id": image_id, "url": url})
    return jsonify({"outputs": outputs})
