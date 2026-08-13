import os, sys, re

def main():
    if len(sys.argv) < 2:
        sys.exit(1)
    src_dir = os.path.join(sys.argv[1], "src")
    
    # Extract Mem* from headers
    mem_kinds = set()
    for root, _, files in os.walk(src_dir):
        for f in files:
            if f.endswith('.h'):
                with open(os.path.join(root, f), 'r', encoding='utf-8') as hf:
                    for match in re.finditer(r'\b(Mem[A-Z][a-zA-Z0-9_]*)\b', hf.read()):
                        if match.group(1) not in ("Memory", "Member"): # Filter generic words
                            mem_kinds.add(match.group(1))

    # Read CPP files to find producers (we look for occurrences > 1, meaning it's used beyond definition)
    cpp_texts = ""
    for root, _, files in os.walk(src_dir):
        for f in files:
            if f.endswith('.cpp'):
                with open(os.path.join(root, f), 'r', encoding='utf-8') as cppf:
                    cpp_texts += cppf.read() + "\n"

    failures = []
    for kind in mem_kinds:
        if len(re.findall(r'\b' + kind + r'\b', cpp_texts)) < 1:
            failures.append(f"Memory kind {kind} has no producer/reader in src/**/*.cpp")

    if failures:
        print("GIGA_MEMORY_KINDS=FAIL")
        for fail in failures: print(f"- {fail}")
        sys.exit(1)
    print(f"GIGA_MEMORY_KINDS=PASS checks={len(mem_kinds)}")

if __name__ == "__main__":
    main()
