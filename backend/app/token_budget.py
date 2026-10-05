"""Text-only Qwen budget, using the bundled official tokenizer and chat envelope.
Groq's reported prompt_tokens remains the billing authority (provider envelope can vary).
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
