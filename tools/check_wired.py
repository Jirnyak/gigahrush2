import os, sys, re

def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    giga_root = sys.argv[1]
    deferred = sys.argv[2:]
    src_dir = os.path.join(giga_root, "src")

    # Find all void <name>_(step|tick) in headers
    entry_points = set()
    for root, _, files in os.walk(src_dir):
        for f in files:
            if f.endswith('.h') or f.endswith('.inl'):
                with open(os.path.join(root, f), 'r', encoding='utf-8', errors='ignore') as hf:
                    for match in re.finditer(r'\bvoid\s+([a-zA-Z0-9_]+_(?:step|tick))\s*\(', hf.read()):
                        entry_points.add(match.group(1))

    deferred_names = [d.split(':')[0] for d in deferred]
    active_ep = [ep for ep in entry_points if ep not in deferred_names]

    # Pre-read cpp files
    cpp_texts = []
    for root, _, files in os.walk(src_dir):
        for f in files:
            if f.endswith('.cpp'):
                with open(os.path.join(root, f), 'r', encoding='utf-8', errors='ignore') as cppf:
                    cpp_texts.append(cppf.read())

    failures = []
    for ep in active_ep:
        called = False
        ep_regex = re.compile(r'\b' + ep + r'\b')
        for content in cpp_texts:
            for match in ep_regex.finditer(content):
                before = content[max(0, match.start() - 20):match.start()]
                if not re.search(r'\bvoid\s+(?:[a-zA-Z0-9_]+\s*::\s*)?$', before):
                    called = True
                    break
            if called: break
        if not called:
            failures.append(f"{ep} has no calls outside tests/ and is not deferred.")

    if failures:
        print("GIGA_WIRED=FAIL")
        for fail in failures: print(f"- {fail}")
        sys.exit(1)
    print(f"GIGA_WIRED=PASS checks={len(entry_points)}")

if __name__ == "__main__":
    main()
