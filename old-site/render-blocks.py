import json, sys
d = json.load(open('chunk.json'))
blocks = {k: v['value'].get('value', v['value']) for k, v in d['recordMap']['block'].items()}
root = "3449c57e-47c7-80e2-a807-e73120a7887d"

def rich(t):
    out = ""
    for seg in t or []:
        s = seg[0]
        if len(seg) > 1:
            for fmt in seg[1]:
                if fmt[0] == 'a': s = f"[{s}]({fmt[1]})"
                elif fmt[0] == 'b': s = f"**{s}**"
                elif fmt[0] == 'i': s = f"*{s}*"
                elif fmt[0] == 'c': s = f"`{s}`"
                elif fmt[0] == 'h': s = f"{{color:{fmt[1]}}}{s}"
                elif fmt[0] == 'd': s = "{date:" + json.dumps(fmt[1]) + "}"
                elif fmt[0] == 'u': s = "{user}"
                elif fmt[0] == 'p': s = "{page:" + fmt[1] + "}"
        out += s
    return out

def walk(bid, depth=0):
    b = blocks.get(bid)
    if not b:
        print("  "*depth + f"<missing block {bid}>"); return
    t = b['type']; p = b.get('properties', {}); f = b.get('format', {})
    title = rich(p.get('title'))
    extra = ""
    if t == 'image' or t == 'embed' or t == 'video' or t == 'bookmark':
        extra = " src=" + rich(p.get('source')) + " caption=" + rich(p.get('caption')) + " fmt=" + json.dumps({k:v for k,v in f.items() if k in ('block_width','block_height','block_aspect_ratio','display_source')})
    if t == 'callout': extra = " icon=" + str(f.get('page_icon')) + " color=" + str(f.get('block_color'))
    if t == 'page' and bid != root: extra = " icon=" + str(f.get('page_icon'))
    if t == 'column': extra = " ratio=" + str(f.get('column_ratio'))
    if t == 'table_row': title = " | ".join(rich(v) for k, v in sorted(p.items()))
    if t == 'table': extra = " cols=" + str(f.get('table_block_column_order'))
    if t == 'to_do': extra = " checked=" + rich(p.get('checked'))
    if f.get('block_color'): extra += " color=" + f['block_color']
    if t == 'collection_view' or t == 'collection_view_page': extra = " collection=" + str(b.get('collection_id')) + " views=" + str(b.get('view_ids'))
    print("  "*depth + f"[{t}]{extra} {title}")
    for c in b.get('content', []):
        walk(c, depth+1)

rb = blocks[root]
print("ROOT format:", json.dumps(rb.get('format', {})))
walk(root)
print("\nRecordMap keys:", {k: len(v) for k, v in d['recordMap'].items() if isinstance(v, dict)})
