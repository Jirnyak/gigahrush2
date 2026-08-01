# Wire RPG formulas into player melee/ranged combat (RPGCMBT)
from pathlib import Path

path = Path(r"C:\hades\gigahrush2\src\game\combat.cpp")
text = path.read_text(encoding="utf-8")
orig = text

# --- MELEE: track held weapon id + resolve swingDmg / swingCd ---
old_melee_wp = """    // Whatever is in hand. A found rebar hits eight times as hard as a fist and
    // reaches four times as far — which is the entire point of picking loot up.
    const MeleeDef* wp = &unarmed_melee();
    if (const NpcRef* n = reg.try_get<NpcRef>(self))
        if (pool.valid(n->id)) {
            const ItemId held = equipped_melee(pool.inventory(n->id));
            if (const MeleeDef* m = melee_for_item(held)) wp = m;
        }
    const float reach =
        static_cast<float>(wp->reachMm) * 0.001f * kCellSize + kMeleeReachSlack;"""

new_melee_wp = """    // Whatever is in hand. A found rebar hits eight times as hard as a fist and
    // reaches four times as far — which is the entire point of picking loot up.
    // RPGCMBT: STR/level scale damage via melee_damage(); AGI shortens cooldown;
    // STR also speeds heavy weapons (cd >= kHeavyWeaponCooldownMs). Without a
    // RpgStats component the raw table values are used (identity mults).
    const MeleeDef* wp = &unarmed_melee();
    ItemId heldWeapon = 0;  // 0 = bare hands sentinel [item_table.h]
    if (const NpcRef* n = reg.try_get<NpcRef>(self))
        if (pool.valid(n->id)) {
            heldWeapon = equipped_melee(pool.inventory(n->id));
            if (const MeleeDef* m = melee_for_item(heldWeapon)) wp = m;
        }
    std::int16_t swingDmg = static_cast<std::int16_t>(wp->dmg);
    std::uint16_t swingCd = wp->cooldownMs;
    if (const RpgStats* rs = reg.try_get<RpgStats>(self)) {
        swingDmg = melee_damage(*rs, heldWeapon, static_cast<std::int16_t>(wp->dmg));
        // Combine AGI attack-speed and STR heavy-weapon speed as e3 mults.
        const std::uint32_t agiE3 = agi_attack_speed_mult_e3(*rs);
        const std::uint32_t strE3 = str_heavy_weapon_speed_mult_e3(*rs, wp->cooldownMs);
        const std::uint32_t cd =
            (static_cast<std::uint32_t>(wp->cooldownMs) * agiE3 * strE3) / 1000000u;
        swingCd = static_cast<std::uint16_t>(cd > 65535u ? 65535u : (cd < 1u ? 1u : cd));
    }
    const float reach =
        static_cast<float>(wp->reachMm) * 0.001f * kCellSize + kMeleeReachSlack;"""

if old_melee_wp not in text:
    raise SystemExit("MELEE WP BLOCK NOT FOUND")
text = text.replace(old_melee_wp, new_melee_wp, 1)

# wall carve dmg + cd
old_wall = """            if (hitWall) {
                carves->push(hitAt.x, hitAt.y, hitAt.z, kMeleeCarveRadius,
                             carve_power_from_dmg(
                                 static_cast<std::int16_t>(wp->dmg)),
                             static_cast<std::uint32_t>(tick));
                pm.cooldownMs = wp->cooldownMs;
                (void)bus;
                return true;
            }"""

new_wall = """            if (hitWall) {
                carves->push(hitAt.x, hitAt.y, hitAt.z, kMeleeCarveRadius,
                             carve_power_from_dmg(swingDmg),
                             static_cast<std::uint32_t>(tick));
                pm.cooldownMs = swingCd;
                (void)bus;
                return true;
            }"""

if old_wall not in text:
    raise SystemExit("WALL BLOCK NOT FOUND")
text = text.replace(old_wall, new_wall, 1)

old_hit = """    DamageResult r = apply_damage(reg, pool, best,
                                  static_cast<std::int16_t>(wp->dmg),
                                  DamageChannel::Kinetic, self);
    pm.cooldownMs = wp->cooldownMs;
    if (r.lethal) ++pm.kills;"""

new_hit = """    DamageResult r = apply_damage(reg, pool, best, swingDmg,
                                  DamageChannel::Kinetic, self);
    pm.cooldownMs = swingCd;
    if (r.lethal) ++pm.kills;"""

if old_hit not in text:
    raise SystemExit("HIT BLOCK NOT FOUND")
text = text.replace(old_hit, new_hit, 1)

# --- RANGED: AGI spread + AGI attack-speed on cooldown ---
old_spread = """    // Spread is applied as a CONE, not as the reference's yaw-only jitter. The
    // reference is 2.5D, so jittering yaw alone was correct there; in true 3D it
    // would put a shotgun's pellets in a dead-flat horizontal line, which reads as a
    // bug rather than as a spread.
    const float spread = static_cast<float>(def->spreadE4) * 1e-4f;"""

new_spread = """    // Spread is applied as a CONE, not as the reference's yaw-only jitter. The
    // reference is 2.5D, so jittering yaw alone was correct there; in true 3D it
    // would put a shotgun's pellets in a dead-flat horizontal line, which reads as a
    // bug rather than as a spread.
    // RPGCMBT: AGI tightens the cone (agi_ranged_spread_mult_e3 < 1000).
    float spread = static_cast<float>(def->spreadE4) * 1e-4f;
    if (const RpgStats* rs = reg.try_get<RpgStats>(shooter)) {
        spread *= static_cast<float>(agi_ranged_spread_mult_e3(*rs)) / 1000.0f;
    }"""

if old_spread not in text:
    raise SystemExit("SPREAD BLOCK NOT FOUND")
text = text.replace(old_spread, new_spread, 1)

old_rcd = """    // ONE round per shot regardless of pellet count — a shotgun blast costs one shell
    // and produces up to twelve projectiles. The reference's rule.
    --pr.magCount;
    pr.cooldownMs = def->cooldownMs;
    ++pr.shots;
    return 1;
}"""

new_rcd = """    // ONE round per shot regardless of pellet count — a shotgun blast costs one shell
    // and produces up to twelve projectiles. The reference's rule.
    --pr.magCount;
    // RPGCMBT: AGI shortens firearm cooldown (same inverse mult as melee).
    std::uint16_t rcd = def->cooldownMs;
    if (const RpgStats* rs = reg.try_get<RpgStats>(shooter)) {
        const std::uint32_t cd =
            (static_cast<std::uint32_t>(def->cooldownMs) *
             agi_attack_speed_mult_e3(*rs)) / 1000u;
        rcd = static_cast<std::uint16_t>(cd > 65535u ? 65535u : (cd < 1u ? 1u : cd));
    }
    pr.cooldownMs = rcd;
    ++pr.shots;
    return 1;
}"""

if old_rcd not in text:
    raise SystemExit("RANGED CD BLOCK NOT FOUND")
text = text.replace(old_rcd, new_rcd, 1)

if text == orig:
    raise SystemExit("NO CHANGES APPLIED")

path.write_text(text, encoding="utf-8", newline="\n")
print("PATCHED combat.cpp RPGCMBT")
print("delta bytes", len(text) - len(orig))
