#include "game/dialogue.h"

#include <cstdio>
#include <cstring>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"
#include "game/faction.h"
#include "game/faction_relations.h"
#include "game/role.h"
#include "game/rumour.h"
#include "game/speech.h"

namespace giga::game {

const char* dialogue_attitude_name(DialogueAttitude att) {
    switch (att) {
        case DialogueAttitude::HeroVeneration:
            return "\xd0\x9f\xd0\xbe\xd1\x87\xd0\xb8\xd1\x82\xd0\xb0\xd0\xbd\xd0\xb8\xd0\xb5 (\xd0\x93\xd0\xb5\xd1\x80\xd0\xbe\xd0\xb9)"; // Почитание (Герой)
        case DialogueAttitude::Friendly:
            return "\xd0\x94\xd1\x80\xd1\x83\xd0\xb6\xd0\xb5\xd0\xbb\xd1\x8e\xd0\xb1\xd0\xb8\xd0\xb5"; // Дружелюбие
        case DialogueAttitude::Neutral:
            return "\xd0\x9d\xd0\xb5\xd0\xb9\xd1\x82\xd1\x80\xd0\xb0\xd0\xbb\xd1\x8c\xd0\xbd\xd0\xbe\xd1\x81\xd1\x82\xd1\x8c"; // Нейтральность
        case DialogueAttitude::Wary:
            return "\xd0\x9d\xd0\xb0\xd1\x81\xd1\x82\xd0\xbe\xd1\x80\xd0\xbe\xd0\xb6\xd0\xb5\xd0\xbd\xd0\xbd\xd0\xbe\xd1\x81\xd1\x82\xd1\x8c"; // Настороженность
        case DialogueAttitude::Hostile:
            return "\xd0\x92\xd1\x80\xd0\xb0\xd0\xb6\xd0\xb4\xd0\xb5\xd0\xb1\xd0\xbd\xd0\xbe\xd1\x81\xd1\x82\xd1\x8c"; // Враждебность
        case DialogueAttitude::AtrocityTerror:
            return "\xd0\xa3\xd0\xb6\xd0\xb0\xd1\x81 (\xd0\x9c\xd1\x8f\xd1\x81\xd0\xbd\xd0\xb8\xd0\xba)"; // Ужас (Мясник)
        case DialogueAttitude::AtrocityVengeful:
            return "\xd0\xaf\xd1\x80\xd0\xbe\xd1\x81\xd1\x82\xd1\x8c (\xd0\x9c\xd1\x81\xd1\x82\xd1\x8c)"; // Ярость (Месть)
        case DialogueAttitude::WarAnxious:
            return "\xd0\x92\xd0\xbe\xd0\xb5\xd0\xbd\xd0\xbd\xd0\xb0\xd1\x8f \xd1\x82\xd1\x80\xd0\xb5\xd0\xb2\xd0\xbe\xd0\xb3\xd0\xb0"; // Военная тревога
        default:
            return "\xd0\x9d\xd0\xb5\xd0\xb8\xd0\xb7\xd0\xb2\xd0\xb5\xd1\x81\xd1\x82\xd0\xbd\xd0\xbe"; // Неизвестно
    }
}

void dialogue_campfire_greeting(char* out, std::size_t cap, Faction f, RoleId role, DialogueAttitude att) {
    (void)f;
    (void)role;
    if (!out || cap < 64) return;
    if (att == DialogueAttitude::HeroVeneration) {
        std::snprintf(out, cap,
                      "\xd0\x9f\xd1\x80\xd0\xb8\xd1\x81\xd0\xb0\xd0\xb6\xd0\xb8\xd0\xb2\xd0\xb0\xd0\xb9\xd1\x81\xd1\x8f "
                      "\xd0\xba \xd0\xbe\xd0\xb3\xd0\xbd\xd1\x8e, \xd0\xb3\xd0\xb5\xd1\x80\xd0\xbe\xd0\xb9. \xd0\x94\xd0\xbb"
                      "\xd1\x8f \xd1\x82\xd0\xb5\xd0\xb1\xd1\x8f \xd0\xb2\xd1\x81\xd0\xb5\xd0\xb3\xd0\xb4\xd0\xb0 \xd0\xb5"
                      "\xd1\x81\xd1\x82\xd1\x8c \xd0\xbc\xd0\xb5\xd1\x81\xd1\x82\xd0\xbe.");
    } else {
        std::snprintf(out, cap,
                      "\xd0\x93\xd1\x80\xd0\xb5\xd0\xb9\xd1\x81\xd1\x8f \xd1\x83 \xd0\xba\xd0\xbe\xd1\x81\xd1\x82\xd1\x80"
                      "\xd0\xb0, \xd0\xbf\xd1\x83\xd1\x82\xd0\xbd\xd0\xb8\xd0\xba. \xd0\xa5\xd0\xbe\xd1\x82\xd1\x8c "
                      "\xd0\xb7\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c \xd0\xbd\xd0\xb5\xd0\xbc\xd0\xbd\xd0\xbe\xd0\xb3\xd0\xbe "
                      "\xd1\x82\xd0\xb5\xd0\xbf\xd0\xbb\xd0\xb0 \xd0\xb8 \xd0\xbf\xd0\xbe\xd0\xba\xd0\xbe\xd1\x8f.");
    }
}

DialoguePrompt generate_dialogue_prompt(
    const Registry& reg,
    const NpcPool& pool,
    NpcId speaker,
    std::int16_t floorZ,
    const FactionRelations& rel,
    const SamosborState& samosbor,
    const RumourNetwork* rumourNet,
    const TerritoryWarManager* territoryMgr) {

    DialoguePrompt prompt{};
    if (!const_cast<NpcPool&>(pool).valid(speaker) || !const_cast<NpcPool&>(pool).alive(speaker)) {
        return prompt;
    }

    const Faction sf = static_cast<Faction>(pool.faction(speaker));
    const RoleId sRole = static_cast<RoleId>(pool.role(speaker));
    const std::uint8_t sfRow = static_cast<std::uint8_t>(sf);

    const std::int8_t playerStanding = rel.at(kFactionPlayerRow, sfRow);

    if (rumourNet == nullptr) {
        rumourNet = &global_rumour_network();
    }
    if (territoryMgr == nullptr) {
        territoryMgr = &global_territory_war_manager();
    }

    // 1. Check propagated rumours for active heroics or atrocities
    const Rumour topRumour = rumourNet->best_rumour_for_npc(pool, speaker, floorZ);

    // 2. Check territory war state on this floor
    const FloorWarRecord* fwr = territoryMgr->find(floorZ);
    bool inWar = false;
    Faction warEnemy = Faction::Citizens;
    if (fwr) {
        for (std::uint8_t other = 0; other < kFactionCount; ++other) {
            if (other != sfRow && fwr->warState[sfRow][other] == FactionWarState::OpenWar) {
                inWar = true;
                warEnemy = static_cast<Faction>(other);
                break;
            }
        }
    }

    // 3. Determine DialogueAttitude
    if (topRumour.valid && topRumour.kind == RumourKind::Atrocity && topRumour.subject == sfRow) {
        // Player committed atrocities against speaker's faction
        if (sRole == RoleId::Duty || playerStanding <= -50) {
            prompt.attitude = DialogueAttitude::AtrocityVengeful;
        } else {
            prompt.attitude = DialogueAttitude::AtrocityTerror;
        }
    } else if (topRumour.valid && topRumour.kind == RumourKind::Heroic && playerStanding >= 0) {
        prompt.attitude = DialogueAttitude::HeroVeneration;
    } else if (inWar) {
        prompt.attitude = DialogueAttitude::WarAnxious;
    } else if (playerStanding <= -50) {
        prompt.attitude = DialogueAttitude::Hostile;
    } else if (playerStanding <= -20) {
        prompt.attitude = DialogueAttitude::Wary;
    } else if (playerStanding >= 30) {
        prompt.attitude = DialogueAttitude::Friendly;
    } else {
        prompt.attitude = DialogueAttitude::Neutral;
    }

    // 4. Generate Greetings and Commercial modifiers based on Attitude
    switch (prompt.attitude) {
        case DialogueAttitude::HeroVeneration:
            prompt.priceMultiplier = 0.85f; // 15% discount for hero
            std::snprintf(prompt.tradeModifierDesc, sizeof(prompt.tradeModifierDesc),
                          "\xd0\xa1\xd0\xba\xd0\xb8\xd0\xb4\xd0\xba\xd0\xb0 15%% (\xd0\x93\xd0\xb5\xd1\x80\xd0\xbe\xd0\xb9)");
            std::snprintf(prompt.greeting, sizeof(prompt.greeting),
                          "\xd0\x97\xd0\xb4\xd1\x80\xd0\xb0\xd0\xb2\xd1\x81\xd1\x82\xd0\xb2\xd1\x83\xd0\xb9, \xd0\xb3"
                          "\xd0\xb5\xd1\x80\xd0\xbe\xd0\xb9! \xd0\x9e \xd1\x82\xd0\xb2\xd0\xbe\xd0\xb8\xd1\x85 \xd0\xbf"
                          "\xd0\xbe\xd0\xb1\xd0\xb5\xd0\xb4\xd0\xb0\xd1\x85 \xd0\xbd\xd0\xb0\xd0\xb4 \xd1\x82\xd0\xb2"
                          "\xd0\xb0\xd1\x80\xd1\x8f\xd0\xbc\xd0\xb8 \xd1\x83\xd0\xb6\xd0\xb5 \xd0\xb3\xd0\xbe\xd0\xb2"
                          "\xd0\xbe\xd1\x80\xd1\x8f\xd1\x82 \xd0\xbf\xd0\xbe \xd0\xb2\xd1\x81\xd0\xb5\xd0\xbc\xd1\x83 "
                          "\xd1\x8d\xd1\x82\xd0\xb0\xd0\xb6\xd1\x83.");
            break;

        case DialogueAttitude::AtrocityVengeful:
            prompt.priceMultiplier = 2.5f;
            prompt.willTrade = false;
            prompt.willOfferQuests = false;
            std::snprintf(prompt.tradeModifierDesc, sizeof(prompt.tradeModifierDesc),
                          "\xd0\xa2\xd0\xbe\xd1\x80\xd0\xb3\xd0\xbe\xd0\xb2\xd0\xbb\xd1\x8f \xd0\xb7\xd0\xb0\xd0\xb1"
                          "\xd0\xbb\xd0\xbe\xd0\xba\xd0\xb8\xd1\x80\xd0\xbe\xd0\xb2\xd0\xb0\xd0\xbd\xd0\xb0 (\xd0\x9c"
                          "\xd1\x8f\xd1\x81\xd0\xbd\xd0\xb8\xd0\xba)");
            std::snprintf(prompt.greeting, sizeof(prompt.greeting),
                          "\xd0\x9c\xd1\x8f\xd1\x81\xd0\xbd\xd0\xb8\xd0\xba... \xd0\xa2\xd1\x8b \xd0\xb2\xd1\x8b\xd1"
                          "\x80\xd0\xb5\xd0\xb7\xd0\xb0\xd0\xbb \xd0\xbd\xd0\xb0\xd1\x88\xd0\xb8\xd1\x85 \xd0\xbd\xd0"
                          "\xb0 \xd1\x8d\xd1\x82\xd0\xb0\xd0\xb6\xd0\xb5 %d! \xd0\xa3\xd0\xb1\xd0\xb8\xd1\x80\xd0\xb0"
                          "\xd0\xb9\xd1\x81\xd1\x8f, \xd0\xbf\xd0\xbe\xd0\xba\xd0\xb0 \xd1\x82\xd0\xb5\xd0\xb1\xd1\x8f "
                          "\xd0\xbd\xd0\xb5 \xd0\xbf\xd1\x80\xd0\xb8\xd1\x81\xd1\x82\xd1\x80\xd0\xb5\xd0\xbb\xd0\xb8\xd0\xbb\xd0\xb8!",
                          static_cast<int>(topRumour.floorZ));
            break;

        case DialogueAttitude::AtrocityTerror:
            prompt.priceMultiplier = 0.5f; // Terrified surrender pricing
            prompt.willFlee = true;
            std::snprintf(prompt.tradeModifierDesc, sizeof(prompt.tradeModifierDesc),
                          "\xd0\xa1\xd1\x82\xd1\x80\xd0\xb0\xd1\x85 (-50%% \xd1\x86\xd0\xb5\xd0\xbd\xd1\x8b)");
            std::snprintf(prompt.greeting, sizeof(prompt.greeting),
                          "\xd0\x9d\xd0\xb5 \xd1\x83\xd0\xb1\xd0\xb8\xd0\xb2\xd0\xb0\xd0\xb9 \xd0\xbc\xd0\xb5\xd0\xbd"
                          "\xd1\x8f! \xd0\xaf \xd1\x81\xd0\xbb\xd1\x8b\xd1\x88\xd0\xb0\xd0\xbb \xd0\xbe \xd1\x82\xd0"
                          "\xbe\xd0\xbc, \xd1\x87\xd1\x82\xd0\xbe \xd1\x82\xd1\x8b \xd1\x81\xd0\xb4\xd0\xb5\xd0\xbb"
                          "\xd0\xb0\xd0\xbb... \xd0\x97\xd0\xb0\xd0\xb1\xd0\xb8\xd1\x80\xd0\xb0\xd0\xb9 \xd0\xb2\xd1\x81"
                          "\xd1\x8c\xd0\xbe, \xd1\x82\xd0\xbe\xd0\xbb\xd1\x8c\xd0\xba\xd0\xbe \xd0\xbd\xd0\xb5 \xd1\x82"
                          "\xd1\x80\xd0\xbe\xd0\xb3\xd0\xb0\xd0\xb9!");
            break;

        case DialogueAttitude::WarAnxious:
            prompt.priceMultiplier = 1.25f;
            std::snprintf(prompt.tradeModifierDesc, sizeof(prompt.tradeModifierDesc),
                          "\xd0\x92\xd0\xbe\xd0\xb5\xd0\xbd\xd0\xbd\xd0\xb0\xd1\x8f \xd0\xbd\xd0\xb0\xd1\x86\xd0\xb5"
                          "\xd0\xbd\xd0\xba\xd0\xb0 +25%%");
            std::snprintf(prompt.greeting, sizeof(prompt.greeting),
                          "\xd0\x97\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c \xd0\xbe\xd0\xbf\xd0\xb0\xd1\x81\xd0\xbd\xd0\xbe. "
                          "\xd0\x98\xd0\xb4\xd1\x91\xd1\x82 \xd0\xb2\xd0\xbe\xd0\xb9\xd0\xbd\xd0\xb0 \xd1\x81 %s. "
                          "\xd0\x94\xd0\xb5\xd1\x80\xd0\xb6\xd0\xb8 \xd0\xbe\xd1\x80\xd1\x83\xd0\xb6\xd0\xb8\xd0\xb5 "
                          "\xd0\xbd\xd0\xb0\xd0\xb3\xd0\xbe\xd1\x82\xd0\xbe\xd0\xb2\xd0\xb5.",
                          faction_name(warEnemy));
            break;

        case DialogueAttitude::Friendly:
            prompt.priceMultiplier = 0.90f;
            std::snprintf(prompt.tradeModifierDesc, sizeof(prompt.tradeModifierDesc),
                          "\xd0\xa1\xd0\xba\xd0\xb8\xd0\xb4\xd0\xba\xd0\xb0 \xd1\x81\xd0\xbe\xd1\x8e\xd0\xb7\xd0\xbd"
                          "\xd0\xb8\xd0\xba\xd0\xb0 10%%");
            std::snprintf(prompt.greeting, sizeof(prompt.greeting),
                          "\xd0\xa0\xd0\xb0\xd0\xb4 \xd1\x82\xd0\xb5\xd0\xb1\xd1\x8f \xd0\xb2\xd0\xb8\xd0\xb4\xd0\xb5"
                          "\xd1\x82\xd1\x8c, \xd0\xb4\xd1\x80\xd1\x83\xd0\xb3. \xd0\xa7\xd0\xb5\xd0\xbc \xd0\xbc\xd0\xbe"
                          "\xd0\xb3\xd1\x83 \xd0\xbf\xd0\xbe\xd0\xbc\xd0\xbe\xd1\x87\xd1\x8c?");
            break;

        case DialogueAttitude::Wary:
            prompt.priceMultiplier = 1.20f;
            std::snprintf(prompt.tradeModifierDesc, sizeof(prompt.tradeModifierDesc),
                          "\xd0\x9d\xd0\xb0\xd1\x86\xd0\xb5\xd0\xbd\xd0\xba\xd0\xb0 +20%%");
            std::snprintf(prompt.greeting, sizeof(prompt.greeting),
                          "\xd0\xa7\xd0\xb5\xd0\xb3\xd0\xbe \xd1\x82\xd0\xb5\xd0\xb1\xd0\xb5 \xd0\xbd\xd1\x83\xd0\xb6"
                          "\xd0\xbd\xd0\xbe? \xd0\x94\xd0\xb5\xd1\x80\xd0\xb6\xd0\xb8 \xd1\x80\xd1\x83\xd0\xba\xd0\xb8 "
                          "\xd0\xbd\xd0\xb0 \xd0\xb2\xd0\xb8\xd0\xb4\xd1\x83.");
            break;

        case DialogueAttitude::Hostile:
            prompt.priceMultiplier = 2.0f;
            prompt.willTrade = false;
            std::snprintf(prompt.tradeModifierDesc, sizeof(prompt.tradeModifierDesc),
                          "\xd0\x9e\xd1\x82\xd0\xba\xd0\xb0\xd0\xb7 \xd0\xb2 \xd1\x82\xd0\xbe\xd1\x80\xd0\xb3\xd0\xbe\xd0\xb2\xd0\xbb\xd0\xb5");
            std::snprintf(prompt.greeting, sizeof(prompt.greeting),
                          "\xd0\x9f\xd1\x80\xd0\xbe\xd0\xb2\xd0\xb0\xd0\xbb\xd0\xb8\xd0\xb2\xd0\xb0\xd0\xb9. \xd0\xa2"
                          "\xd0\xb5\xd0\xb1\xd0\xb5 \xd0\xb7\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c \xd0\xbd\xd0\xb5 \xd1\x80"
                          "\xd0\xb0\xd0\xb4\xd1\x8b.");
            break;

        case DialogueAttitude::Neutral:
        default:
            prompt.priceMultiplier = 1.0f;
            prompt.tradeModifierDesc[0] = 0;
            std::snprintf(prompt.greeting, sizeof(prompt.greeting),
                          "\xd0\x97\xd0\xb4\xd1\x80\xd0\xb0\xd0\xb2\xd1\x81\xd1\x82\xd0\xb2\xd1\x83\xd0\xb9, \xd0\xbf"
                          "\xd1\x83\xd1\x82\xd0\xbd\xd0\xb8\xd0\xba. \xd0\x95\xd1\x81\xd1\x82\xd1\x8c \xd0\xb4\xd0\xb5"
                          "\xd0\xbb\xd0\xbe \xd0\xb8\xd0\xbb\xd0\xb8 \xd0\xbf\xd1\x80\xd0\xbe\xd1\x81\xd1\x82\xd0\xbe "
                          "\xd0\xbc\xd0\xb8\xd0\xbc\xd0\xbe \xd0\xbf\xd1\x80\xd0\xbe\xd1\x85\xd0\xbe\xd0\xb4\xd0\xb8\xd1\x88\xd1\x8c?");
            break;
    }

    // 5. Generate Rumour Response
    const Rumour r = rumour_for(reg, pool, speaker, 0, floorZ, samosbor, rumourNet);
    rumour_text(r, prompt.rumourResponse, sizeof(prompt.rumourResponse));

    // 6. Generate War Response
    if (fwr && fwr->totalCasualties > 0) {
        std::snprintf(prompt.warResponse, sizeof(prompt.warResponse),
                      "\xd0\x9e\xd0\xb1\xd1\x81\xd1\x82\xd0\xb0\xd0\xbd\xd0\xbe\xd0\xb2\xd0\xba\xd0\xb0: "
                      "\xd0\xbf\xd0\xbe\xd1\x82\xd0\xb5\xd1\x80\xd0\xb8 \xd0\xbd\xd0\xb0 \xd1\x8d\xd1\x82\xd0\xb0"
                      "\xd0\xb6\xd0\xb5 — %u \xd1\x87\xd0\xb5\xd0\xbb. \xd0\xa1\xd1\x82\xd0\xb0\xd1\x82\xd1\x83\xd1"
                      "\x81: [%s].",
                      fwr->totalCasualties,
                      faction_war_state_name_ru(fwr->warState[sfRow][static_cast<std::uint8_t>(warEnemy)]));
    } else {
        std::snprintf(prompt.warResponse, sizeof(prompt.warResponse),
                      "\xd0\x9d\xd0\xb0 \xd1\x8d\xd1\x82\xd0\xb0\xd0\xb6\xd0\xb5 \xd0\xbe\xd1\x82\xd0\xbd\xd0\xbe\xd1"
                      "\x81\xd0\xb8\xd1\x82\xd0\xb5\xd0\xbb\xd1\x8c\xd0\xbd\xd0\xbe \xd1\x81\xd0\xbf\xd0\xbe\xd0\xba"
                      "\xd0\xbe\xd0\xb9\xd0\xbd\xd0\xbe.");
    }

    return prompt;
}

} // namespace giga::game
