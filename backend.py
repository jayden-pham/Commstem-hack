from pathlib import Path
from io import BytesIO
from PIL import Image
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List, Tuple
import mimetypes, os, time, uuid, threading

# pip install google-genai pillow python-dotenv
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()  # reads .env

# ---------- small thread-safe logger ----------
_print_lock = threading.Lock()
def log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)

TEMPLATE = """TASK
You are an image editor. First, if provided, apply the GLOBAL DIRECTIVE to the whole image. Then read every instruction box, perform those edits, and finally remove all boxes.

GLOBAL DIRECTIVE (optional, scene-wide)
• VALUE: "{GLOBAL_DIRECTIVE}"

WHAT COUNTS AS A BOX
• A dark/black semi-transparent rectangle with white text.
• Use the box center as the anchor; affect the box area (expand up to ~3× if needed).

ALLOWED ACTIONS (case-insensitive)
• ADD / REMOVE / REPLACE A WITH B / SWAP TO <style>.

EDITING RULES
• Preserve composition; only change what is requested.
• Match lighting, shadows, reflections, textures, perspective, DOF.
• Respect occlusions; cast plausible shadows.
• Local box instructions override the global directive in their region.
• Apply boxes in order: REMOVE → REPLACE → ADD → SWAP.
• Remove all boxes at the end (no outlines, no text).

VARIATION HINT
• Produce a distinct but valid variant #{VAR} by varying only non-essential attributes (crop/viewpoint, subtle grade/DOF, micro-lighting), never adding/removing beyond the requested edits.

OUTPUT
• Return the edited IMAGE only — no overlays, no captions, no borders, no boxes.
"""

# ------------------------ helpers ------------------------

_FORMAT_TO_MIME = {
    "PNG":  "image/png",
    "JPEG": "image/jpeg",
    "JPG":  "image/jpeg",
    "WEBP": "image/webp",
    "BMP":  "image/bmp",
    "TIFF": "image/tiff",
    "TIF":  "image/tiff",
}

_FORMAT_TO_SUFFIX = {
    "PNG":  ".png",
    "JPEG": ".jpg",
    "JPG":  ".jpg",
    "WEBP": ".webp",
    "BMP":  ".bmp",
    "TIFF": ".tiff",
    "TIF":  ".tiff",
}

def _build_prompt(global_str: str, variant_idx: int) -> str:
    g = (global_str or "").strip()
    return TEMPLATE.replace("{GLOBAL_DIRECTIVE}", g if g else "NONE").replace("{VAR}", str(variant_idx))

def _infer_mime_and_suffix_from_bytes(photo_bytes: bytes, filename_hint: Optional[str]) -> Tuple[str, str]:
    """Infer a MIME type and file suffix using filename hint first, then PIL format."""
    mime_hint = None
    suffix_hint = None
    if filename_hint:
        mime_hint, _ = mimetypes.guess_type(filename_hint)
        suffix_hint = Path(filename_hint).suffix.lower() or None

    # Validate & probe with PIL
    with Image.open(BytesIO(photo_bytes)) as im:
        fmt = (im.format or "").upper()

    mime_pil   = _FORMAT_TO_MIME.get(fmt)
    suffix_pil = _FORMAT_TO_SUFFIX.get(fmt)

    mime   = mime_hint or mime_pil or "image/png"
    suffix = suffix_hint or suffix_pil or ".png"
    return mime, suffix

def _download_file_bytes(client: genai.Client, file_uri: str) -> bytes:
    for kw in ("name", "file"):
        try:
            return client.files.download(**{kw: file_uri})
        except TypeError:
            continue
    raise TypeError("files.download() signature not recognized; update google-genai.")

def _extract_image_from_response(resp, client: genai.Client) -> Tuple[Optional[bytes], Optional[str]]:
    # inline_data
    for cand in getattr(resp, "candidates", []) or []:
        parts = getattr(getattr(cand, "content", None), "parts", []) or []
        for part in parts:
            if getattr(part, "inline_data", None):
                data = part.inline_data.data
                mt = getattr(part.inline_data, "mime_type", None) or "image/png"
                return data, mt
    # file_data
    for cand in getattr(resp, "candidates", []) or []:
        parts = getattr(getattr(cand, "content", None), "parts", []) or []
        for part in parts:
            fd = getattr(part, "file_data", None)
            if fd and getattr(fd, "file_uri", None):
                data = _download_file_bytes(client, fd.file_uri)
                mt = getattr(fd, "mime_type", None) or "image/png"
                return data, mt
    return None, None

# --------------------- main function ---------------------
from typing import Optional, Union, List  # make sure these are imported

def generate_four_edits_from_bytes(
    photo_bytes: bytes,
    global_directive: str,
    *,
    filename_hint: Optional[str] = None,         # e.g., "2.png"
    outputs_dir: Union[str, Path] = "outputs",   # ← was str | Path
    model_name: str = "gemini-2.5-flash-image-preview",
    temperature: float = 0.4,
    max_workers: int = 4,
    api_key: Optional[str] = None,
    client: Optional[genai.Client] = None,
) -> List[Path]:
    
    """
    Generate FOUR edited variants for a single image (provided as BYTES) and save them to outputs_dir.
    Prints: call start, response received, and duration per API call.
    """
    total_t0 = time.perf_counter()
    _client: genai.Client = client or genai.Client(api_key=api_key or os.getenv("GEMINI_API_KEY"))

    # Validate / infer formats
    mime, suffix = _infer_mime_and_suffix_from_bytes(photo_bytes, filename_hint)
    size_kb = len(photo_bytes) / 1024.0

    # Stem for naming
    base_stem = Path(filename_hint).stem if filename_hint else "upload"
    stem = f"{base_stem}_{uuid.uuid4().hex[:8]}"

    outputs_dir = Path(outputs_dir); outputs_dir.mkdir(parents=True, exist_ok=True)

    # Create a reusable inline Part once
    part = types.Part.from_bytes(data=photo_bytes, mime_type=mime)

    log(f"[{stem}] BYTES INPUT size={size_kb:.1f} KB, mime={mime}")

    def _one_variant(i: int) -> Path:
        prompt = _build_prompt(global_directive, i)
        out_path = outputs_dir / f"{stem}_v{i}{suffix}"

        backoff = 1.0
        last_err: Optional[Exception] = None
        for attempt in range(1, 5):
            try:
                call_t0 = time.perf_counter()
                log(f"[{stem} v{i}] CALL attempt {attempt} → model={model_name}, temp={temperature}")
                resp = _client.models.generate_content(
                    model=model_name,
                    contents=[prompt, part],  # prompt first, then inline bytes
                    config=types.GenerateContentConfig(
                        response_modalities=["IMAGE"],
                        temperature=temperature,
                    ),
                )
                call_dt = time.perf_counter() - call_t0
                log(f"[{stem} v{i}] RECV ← {call_dt:.2f}s")

                img_bytes, _ = _extract_image_from_response(resp, _client)
                if not img_bytes:
                    raise RuntimeError("No image bytes returned (safety/decoding).")

                Image.open(BytesIO(img_bytes)).save(out_path)
                log(f"[{stem} v{i}] SAVED → {out_path}")
                return out_path

            except Exception as e:
                last_err = e
                log(f"[{stem} v{i}] RETRY {attempt} error: {e}")
                time.sleep(backoff)
                backoff = min(backoff * 2, 8.0)

        raise RuntimeError(f"Variant {i} failed after retries: {last_err}")

    # Run 4 variants in parallel
    saved: List[Path] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(_one_variant, i) for i in range(1, 5)]
        for fut in as_completed(futures):
            try:
                saved.append(fut.result())
            except Exception as e:
                log(f"[{stem}] [WARN] {filename_hint or 'upload'}: {e}")

    total_dt = time.perf_counter() - total_t0
    log(f"[{stem}] SUMMARY: {len(saved)}/4 variant(s) in {total_dt:.2f}s")

    if not saved:
        raise RuntimeError("All variants failed.")
    return sorted(saved)

# EXAMPLE USAGE:
# Read the original image into bytes (e.g., from disk or from an upload)
# with open("images/2.png", "rb") as f:
#     photo_bytes = f.read()

# paths = generate_four_edits_from_bytes(
#     photo_bytes=photo_bytes,
#     global_directive="Change the weather from summer to winter",
#     filename_hint="2.png",     # helps pick the correct suffix and MIME; optional
#     outputs_dir="outputs"
# )

# print("Saved files:")
# for p in paths:
#     print(" -", p)
