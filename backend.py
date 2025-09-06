from pathlib import Path
from io import BytesIO
from PIL import Image
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Union, List, Tuple
import mimetypes, os, time, uuid, threading

# pip install google-genai pillow python-dotenv
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()  # reads .env in the cwd or project root

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

def _guess_mime(path: Path) -> str:
    mt, _ = mimetypes.guess_type(path.as_posix())
    return mt or "image/png"

def _build_prompt(global_str: str, variant_idx: int) -> str:
    g = (global_str or "").strip()
    return TEMPLATE.replace("{GLOBAL_DIRECTIVE}", g if g else "NONE").replace("{VAR}", str(variant_idx))

def _download_file_bytes(client: genai.Client, file_uri: str) -> bytes:
    # Be tolerant to SDK signature differences
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

def generate_four_edits(
    photo_path: Union[str, Path],
    global_directive: str,
    *,
    outputs_dir: Union[str, Path] = "outputs",
    model_name: str = "gemini-2.5-flash-image-preview",
    temperature: float = 0.4,
    max_workers: int = 4,
    api_key: Optional[str] = None,
    client: Optional[genai.Client] = None,
) -> List[Path]:
    """
    Generate FOUR edited variants for a single image and save them to outputs_dir.
    Prints: call start, response received, and duration per API call.
    """
    total_t0 = time.perf_counter()

    # Create/obtain client
    _client: genai.Client = client or genai.Client(api_key=api_key or os.getenv("GEMINI_API_KEY"))

    photo_path = Path(photo_path)
    if not photo_path.exists():
        raise FileNotFoundError(photo_path)

    outputs_dir = Path(outputs_dir); outputs_dir.mkdir(parents=True, exist_ok=True)

    mime = _guess_mime(photo_path)
    suffix = photo_path.suffix or ".png"

    # Unique stem per run to avoid collisions
    stem = f"{photo_path.stem}_{uuid.uuid4().hex[:8]}"

    # Upload once and reuse for all variants
    up_t0 = time.perf_counter()
    log(f"[{stem}] UPLOAD → {photo_path.name} (mime={mime})")
    try:
        try:
            file_handle = _client.files.upload(file=str(photo_path), mime_type=mime)
        except TypeError:
            file_handle = _client.files.upload(file=str(photo_path))
    finally:
        up_dt = time.perf_counter() - up_t0
        log(f"[{stem}] UPLOAD DONE ← {up_dt:.2f}s")

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
                    contents=[prompt, file_handle],  # prompt first, then file
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

        raise RuntimeError("Variant {} failed after retries: {}".format(i, last_err))

    # Run 4 variants in parallel
    saved: List[Path] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(_one_variant, i) for i in range(1, 5)]
        for fut in as_completed(futures):
            try:
                saved.append(fut.result())
            except Exception as e:
                log(f"[{stem}] [WARN] {photo_path.name}: {e}")

    total_dt = time.perf_counter() - total_t0
    log(f"[{stem}] SUMMARY: {len(saved)}/4 variant(s) in {total_dt:.2f}s")

    if not saved:
        raise RuntimeError("All variants failed.")
    return sorted(saved)

paths = generate_four_edits(
    photo_path="images/2.png",
    global_directive="Change the weather from summer to winter",
)
