import os
import csv
import re
import sys

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    data_dir = os.path.join(repo_root, 'data')
    src_dir = os.path.join(repo_root, 'src')

    # Whitelist / Deferred list with reasons
    deferred = {
        "nav_step_sub": "sub-step logic not yet ported",
        "nav_climb_sub": "climb logic not yet ported",
        "nav_drop_sub": "drop logic not yet ported",
        "nav_fly": "flying NPCs not supported yet",
        "ai_flags": "AI flag strings to be parsed",
        
        # from items/economy/loot/monsters
        "tags_all": "tags (465 distinct strings) no consumer",
        "tags_hot": "tags hot no consumer",
        "tag_count": "tags count no consumer",
        "name_en": "no localization or inspect UI",
        "desc_ru": "no localization or inspect UI",
        "ammo_id": "needs interned string ids; nothing fires yet",
        "use_grant_id": "needs interned string ids; nothing fires yet",
        "use_grant_n": "needs interned string ids; nothing fires yet",
        "science_value": "no faction or trade system",
        "contraband_score": "no faction or trade system",
        "deceptive_score": "no faction or trade system",
        "stack_declared": "stack validation data",
        "def_src": "source string info",
        "eco_src": "source string info",
        "comment": "comment column",
        "n_rare_drops": "internal stats column",
        "has_loot_table": "internal stats column",
        "use_b": "unused use action slot",
        "spawn_count_max": "internal stats column",
        "n_ai_flags": "internal stats column",
    }

    # Find all CSV files in data/
    csv_files = []
    for root, _, files in os.walk(data_dir):
        for file in files:
            if file.endswith('.csv'):
                csv_files.append(os.path.join(root, file))

    columns = set()
    for csv_file in csv_files:
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            try:
                headers = next(reader)
                for h in headers:
                    h = h.strip()
                    if h:
                        columns.add(h)
            except StopIteration:
                pass

    src_contents = ""
    for search_dir in [src_dir, os.path.join(repo_root, 'tools')]:
        for root, _, files in os.walk(search_dir):
            for file in files:
                if file.endswith('.cpp') or file.endswith('.h') or file.endswith('.py'):
                    path = os.path.join(root, file)
                    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                        src_contents += f.read()

    # Now verify each column is either in deferred list or appears in src_contents
    failures = 0
    for col in columns:
        if col in deferred:
            continue
        
        # A column is considered read if its string literal appears in the code, e.g. "col_name"
        if f'"{col}"' not in src_contents:
            print(f"ERROR: CSV Column '{col}' has no reader in src/ and is not deferred.")
            failures += 1

    if failures > 0:
        print(f"GIGA_CSV_COLUMNS=FAIL ({failures} unread columns)")
        sys.exit(1)
    else:
        print("GIGA_CSV_COLUMNS=PASS")
        sys.exit(0)

if __name__ == "__main__":
    main()
