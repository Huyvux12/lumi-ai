"""Local Qwen/OpenAI token estimates; provider-reported usage is the billing authority.
Vocabulary files are bundled and hash-verified; no network downloads at runtime.
"""

from functools import lru_cache
from pathlib import Path

from tokenizers import Tokenizer


@lru_cache(maxsize=1)
def tokenizer():
    return Tokenizer.from_file(str(Path(__file__).parent / "seed" / "qwen-tokenizer.json"))


def prompt_tokens(messages):
    # Generation prompt, disabled thinking, plus a margin for provider-specific framing.
    text = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages)
    text += "<|im_start|>assistant\n<think>\n\n</think>\n\n"
    return len(tokenizer().encode(text, add_special_tokens=False).ids) + 64


@lru_cache(maxsize=2)
def openai_tokenizer(name):
    import json

    import tiktoken
    from tiktoken.load import load_tiktoken_bpe

    root = Path(__file__).parent / "seed"
    metadata = json.loads((root / "openai-tokenizers.json").read_text())[name]
    hashes = {
        "cl100k_base": "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7",
        "o200k_base": "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d",
    }
    ranks = load_tiktoken_bpe(str(root / f"{name}.tiktoken"), expected_hash=hashes[name])
    return tiktoken.Encoding(**metadata, mergeable_ranks=ranks)


def provider_prompt_tokens(messages, method):
    if method == "qwen":
        return prompt_tokens(messages)
    if method in {"cl100k_base", "o200k_base"}:
        encoder = openai_tokenizer(method)
        return (
            sum(len(encoder.encode(message["content"], disallowed_special=())) + 8 for message in messages)
            + 64
        )
    return sum(len(message["content"].encode("utf-8")) + 32 for message in messages) + 64
