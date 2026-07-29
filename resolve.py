import re

def resolve_file(filepath, resolvers):
    with open(filepath, 'r') as f:
        content = f.read()

    # Split by conflict markers
    # We will find all <<<<<<< HEAD ... ======= ... >>>>>>> origin/main
    pattern = re.compile(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)(?:>>>>>>> origin/main\n|>>>>>>> origin/main)', re.DOTALL)
    
    matches = list(pattern.finditer(content))
    if len(matches) != len(resolvers):
        print(f"Error: {filepath} has {len(matches)} conflicts, but {len(resolvers)} resolvers provided.")
        return

    offset = 0
    new_content = ""
    last_end = 0

    for i, match in enumerate(matches):
        head_block = match.group(1)
        origin_block = match.group(2)
        
        resolved = resolvers[i](head_block, origin_block)
        
        new_content += content[last_end:match.start()] + resolved
        last_end = match.end()

    new_content += content[last_end:]
    
    with open(filepath, 'w') as f:
        f.write(new_content)
    print(f"Resolved {filepath}")

# 1. floor_stream.cpp
def fs_res1(head, origin):
    return origin

resolve_file('src/game/floor_stream.cpp', [fs_res1])

# 2. game_test.cpp
def gt_res1(head, origin):
    return origin + head

def gt_res2(head, origin):
    return origin

def gt_res3(head, origin):
    return origin + head

resolve_file('tests/game_test.cpp', [gt_res1, gt_res2, gt_res3])

# 3. main.cpp
def m_res1(head, origin):
    return origin

def m_res2(head, origin):
    return origin

def m_res3(head, origin):
    # Origin block adds craftWanted, scrapWanted, aiCfg, aiTick, crafting, crafted, scrapped, recipesLearned, loot
    # We want to replace origin's `std::int32_t loot = 0;` with the maybe_unused version from HEAD.
    head_comment = "    // [[maybe_unused]]: the HUD prints `carried` (live inventory value), not this\n    // run-total, after the branch merge — but `loot += ...` wraps the container/pickup\n    // hooks that actually move the roubles, so the accumulator is kept. Clang warns,\n    // MSVC did not.\n    [[maybe_unused]] std::int32_t loot = 0;         // roubles swept up this run\n"
    # The origin block ends with std::int32_t loot = 0;         // roubles swept up this run\n
    return origin.replace("    std::int32_t loot = 0;         // roubles swept up this run\n", head_comment)

def m_res4(head, origin):
    # Merge genMode != WorldGenMode::Maze into origin's if condition
    return origin.replace("if (simTick % game::kMacroPeriodTicks == 0) {", "if (genMode != WorldGenMode::Maze && simTick % game::kMacroPeriodTicks == 0) {")

resolve_file('src/app/main.cpp', [m_res1, m_res2, m_res3, m_res4])
