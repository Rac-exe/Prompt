"""
SPLADE sparse neural embedding service.

Uses Xenova/splade-pp-en-v1 (ONNX export) to produce sparse token-weight
vectors for keyword-level retrieval that outperforms BM25/FTS5 by learning
which tokens are semantically important in context.

Architecture mirrors reranker.py: lazy singleton, thread-safe lock, graceful
fallback to None on any load/inference failure.
"""

from __future__ import annotations

import json
import logging
from threading import Lock
from typing import Optional

import numpy as np

from app.config import SPLADE_ENABLED, SPLADE_MIN_WEIGHT, SPLADE_MODEL

logger = logging.getLogger("code-intel.sparse_embedding")

_model_lock = Lock()
_model_loaded = False
_model_failed = False
_ort_session = None
_tokenizer = None
_vocab: Optional[dict[int, str]] = None  # id -> token string


def _get_splade_model():
    """Lazy-load the SPLADE ONNX model and tokenizer. Thread-safe singleton."""
    global _model_loaded, _model_failed, _ort_session, _tokenizer, _vocab
    if _model_loaded:
        return _ort_session, _tokenizer, _vocab
    if _model_failed:
        return None, None, None
    with _model_lock:
        if _model_loaded:
            return _ort_session, _tokenizer, _vocab
        if _model_failed:
            return None, None, None
        try:
            import os

            import onnxruntime as ort
            from huggingface_hub import hf_hub_download
            from tokenizers import Tokenizer

            tokenizer_path = hf_hub_download(repo_id=SPLADE_MODEL, filename="tokenizer.json")
            model_path = _download_splade_model(hf_hub_download)

            _tokenizer = Tokenizer.from_file(tokenizer_path)
            _tokenizer.enable_padding()
            _tokenizer.enable_truncation(max_length=512)

            sess_options = ort.SessionOptions()
            sess_options.intra_op_num_threads = max(1, min(2, os.cpu_count() or 2))
            _ort_session = ort.InferenceSession(model_path, sess_options=sess_options)

            # Build reverse vocab mapping: token_id -> token_string
            vocab_dict = _tokenizer.get_vocab()
            _vocab = {v: k for k, v in vocab_dict.items()}

            _model_loaded = True
            logger.info("SPLADE model loaded: model=%s", SPLADE_MODEL)
            return _ort_session, _tokenizer, _vocab
        except Exception as e:
            _model_failed = True
            logger.warning("Failed to load SPLADE model=%s: %s", SPLADE_MODEL, e)
            return None, None, None


def _download_splade_model(hf_hub_download) -> str:
    candidates = (
        "onnx/model.onnx",
        "onnx/model_quantized.onnx",
        "model.onnx",
    )
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            return hf_hub_download(repo_id=SPLADE_MODEL, filename=candidate)
        except Exception as e:
            last_error = e
    if last_error:
        raise last_error
    raise RuntimeError("No ONNX SPLADE model file found")


def compute_sparse(text: str) -> dict[str, float]:
    """
    Compute a SPLADE sparse vector for a single text.

    Returns a dict mapping token strings to positive weights.
    Only tokens above SPLADE_MIN_WEIGHT are included (~100-300 entries).
    Returns an empty dict if the model is unavailable.
    """
    if not SPLADE_ENABLED:
        return {}
    results = compute_sparse_batch([text])
    return results[0] if results else {}


def compute_sparse_batch(texts: list[str]) -> list[dict[str, float]]:
    """
    Compute SPLADE sparse vectors for a batch of texts.

    Returns a list of dicts, one per input text. Each dict maps token
    strings to positive float weights. Returns empty dicts on failure.
    """
    if not SPLADE_ENABLED or not texts:
        return [{} for _ in texts]

    session, tokenizer, vocab = _get_splade_model()
    if session is None or tokenizer is None or vocab is None:
        return [{} for _ in texts]

    try:
        return [_infer_single(session, tokenizer, vocab, text) for text in texts]
    except Exception as e:
        logger.warning("SPLADE batch inference failed: %s", e)
        return [{} for _ in texts]


def _infer_single(session, tokenizer, vocab: dict[int, str], text: str) -> dict[str, float]:
    """Run SPLADE inference on a single text."""
    encoding = tokenizer.encode(text)
    ids = encoding.ids
    attention = encoding.attention_mask

    input_ids = np.asarray([ids], dtype=np.int64)
    attention_mask = np.asarray([attention], dtype=np.int64)

    inputs: dict = {}
    for inp in session.get_inputs():
        lname = inp.name.lower()
        if "input_ids" in lname:
            inputs[inp.name] = input_ids
        elif "attention_mask" in lname:
            inputs[inp.name] = attention_mask
        elif "token_type" in lname:
            inputs[inp.name] = np.zeros_like(input_ids, dtype=np.int64)

    # SPLADE MLM head: logits shape [1, seq_len, vocab_size]
    outputs = session.run(None, inputs)
    logits = np.asarray(outputs[0])  # [1, seq_len, vocab_size]

    # ReLU + max-pool over sequence dimension
    relu_logits = np.maximum(logits, 0.0)  # [1, seq_len, vocab_size]

    # Mask padding positions before max-pool
    mask = attention_mask[0]  # [seq_len]
    relu_logits[0] *= mask[:, np.newaxis]

    # Max-pool across sequence dimension -> [vocab_size]
    sparse_vec = relu_logits[0].max(axis=0)

    # Build sparse dict: only keep tokens above threshold
    result: dict[str, float] = {}
    nonzero_ids = np.where(sparse_vec > SPLADE_MIN_WEIGHT)[0]
    for token_id in nonzero_ids:
        token_str = vocab.get(int(token_id))
        if token_str and not token_str.startswith("##"):
            result[token_str] = float(sparse_vec[token_id])

    return result


def dot_product(query_sparse: dict[str, float], doc_sparse: dict[str, float]) -> float:
    """Compute dot product between two sparse vectors (intersection of keys)."""
    if not query_sparse or not doc_sparse:
        return 0.0
    score = 0.0
    for token, q_weight in query_sparse.items():
        d_weight = doc_sparse.get(token)
        if d_weight:
            score += q_weight * d_weight
    return score
