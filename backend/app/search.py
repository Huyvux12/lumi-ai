import unicodedata


def normalized(text):
    return "".join(
        c
        for c in unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
        if not unicodedata.combining(c)
    )


def character_search(data):
    return normalized(" ".join(str(data.get(k, "")) for k in ("name", "tagline", "description", "tags")))
