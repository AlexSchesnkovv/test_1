#!/usr/bin/env python3
import re
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Comment
from deep_translator import GoogleTranslator

SRC = Path('/workspace/index_gospital.html')
DST = SRC  # overwrite in-place

# Tags to skip when translating text nodes
SKIP_TAGS = {'script', 'style', 'noscript'}
# Attributes that may contain visible text to translate
ATTRS_TO_TRANSLATE = ['alt', 'title', 'placeholder', 'aria-label']
# Additionally, translate value attribute for these input types
BUTTON_INPUT_TYPES = {'submit', 'button', 'reset'}

CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")


def should_translate_text(text: str) -> bool:
    if not text:
        return False
    if text.strip() == '':
        return False
    if text.strip().startswith(('<!--', '-->')):
        return False
    # Only translate if there is Cyrillic (heuristic for Russian text)
    return CYRILLIC_RE.search(text) is not None


def preserve_edges(original: str, translated: str) -> str:
    # Preserve leading and trailing whitespace
    leading = len(original) - len(original.lstrip())
    trailing = len(original) - len(original.rstrip())
    return original[:leading] + translated + original[len(original) - trailing:]


def collect_text_nodes(soup: BeautifulSoup):
    nodes = []
    for element in soup.descendants:
        if isinstance(element, NavigableString):
            parent = element.parent
            if parent and parent.name in SKIP_TAGS:
                continue
            if isinstance(element, Comment):
                continue
            text = str(element)
            if should_translate_text(text):
                nodes.append(element)
    return nodes


def collect_attr_values(soup: BeautifulSoup):
    items = []  # (element, attr_name_or_tuple, original_value)
    for el in soup.find_all(True):
        for attr in ATTRS_TO_TRANSLATE:
            if el.has_attr(attr):
                val = el.get(attr)
                if isinstance(val, list):
                    for i, v in enumerate(val):
                        if isinstance(v, str) and should_translate_text(v):
                            items.append((el, (attr, i), v))
                else:
                    if isinstance(val, str) and should_translate_text(val):
                        items.append((el, attr, val))
        if el.name == 'input' and el.get('type', '').lower() in BUTTON_INPUT_TYPES:
            if el.has_attr('value') and isinstance(el['value'], str) and should_translate_text(el['value']):
                items.append((el, 'value', el['value']))
    return items


def translate_unique_texts(texts):
    # Deduplicate while preserving order
    seen = set()
    ordered = []
    for t in texts:
        key = t.strip()
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        ordered.append(key)

    if not ordered:
        return {}

    translator = GoogleTranslator(source='ru', target='kk')
    mapping = {}

    # Try batch translation first (available in deep-translator)
    try:
        batch_result = translator.translate_batch(ordered)  # type: ignore[attr-defined]
        if isinstance(batch_result, list) and len(batch_result) == len(ordered):
            for src_text, dst_text in zip(ordered, batch_result):
                mapping[src_text] = dst_text
            return mapping
    except Exception:
        pass

    # Fallback to item-by-item translation
    for key in ordered:
        try:
            mapping[key] = translator.translate(key)
        except Exception:
            mapping[key] = key
    return mapping


def preserve_doctype(original_html: str, new_html: str) -> str:
    # If original had a doctype but new_html does not, prepend it
    m = re.match(r"\s*(<!DOCTYPE[^>]*>)", original_html, flags=re.IGNORECASE | re.DOTALL)
    if m:
        doctype = m.group(1)
        if '<!doctype' not in new_html.lower():
            return f"{doctype}\n{new_html}"
    return new_html


def main():
    html = SRC.read_text(encoding='utf-8', errors='ignore')
    soup = BeautifulSoup(html, 'html.parser')

    # Track <title> text
    head_title_node = None
    if soup.title and isinstance(soup.title.string, NavigableString):
        head_title_node = soup.title

    text_nodes = collect_text_nodes(soup)
    attr_items = collect_attr_values(soup)

    candidates = []
    for node in text_nodes:
        candidates.append(str(node).strip())
    for _el, _attr, val in attr_items:
        candidates.append(val.strip())
    if head_title_node and should_translate_text(head_title_node.string or ''):
        candidates.append((head_title_node.string or '').strip())

    mapping = translate_unique_texts(candidates)

    for node in text_nodes:
        original = str(node)
        key = original.strip()
        translated = mapping.get(key)
        if translated is None:
            continue
        node.replace_with(preserve_edges(original, translated))

    for el, attr, val in attr_items:
        key = val.strip()
        translated = mapping.get(key)
        if translated is None:
            continue
        if isinstance(attr, tuple):
            name, idx = attr
            arr = el.get(name)
            if isinstance(arr, list) and 0 <= idx < len(arr):
                arr[idx] = translated
                el[name] = arr
        else:
            el[attr] = translated

    if head_title_node and should_translate_text(head_title_node.string or ''):
        key = (head_title_node.string or '').strip()
        translated = mapping.get(key)
        if translated:
            head_title_node.string.replace_with(translated)

    new_html = str(soup)
    new_html = preserve_doctype(html, new_html)

    DST.write_text(new_html, encoding='utf-8')


if __name__ == '__main__':
    main()
