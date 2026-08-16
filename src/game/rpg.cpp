#include "game/rpg.h"

#include <cmath>
#include <cstring>
#include <algorithm>

#include "core/rng.h"

namespace giga::game {
namespace {

// Reference constants
constexpr float kStrHpPerPoint = 0.01f;
constexpr float kStrMeleeDamagePerPoint = 0.01f;
constexpr float kStrDurabilityWearPerPoint = 0.08f;
constexpr float kStrHeavyWeaponSpeedPerPoint = 0.05f;

constexpr float kAgiMoveSpeedPerPoint = 0.01f;
constexpr float kAgiAttackCooldownPerPoint = 0.02f;
constexpr float kAgiSpreadPerPoint = 0.12f;
constexpr float kAgiDodgePerPoint = 0.008f;
constexpr float kAgiDodgeAsymptote = 0.25f;

constexpr float kEndHpPerPoint = 0.015f;
constexpr float kEndRadResistPerPoint = 0.05f;
constexpr float kEndRadResistAsymptote = 0.60f;
constexpr float kEndStaminaDrainPerPoint = 0.03f;

constexpr float kIntPsiPerPoint = 0.01f;
constexpr float kIntPsiDurationSecPerPoint = 1.0f;
constexpr float kIntXpBonusPerPoint = 0.08f;
constexpr float kIntXpBonusAsymptote = 1.0f;
constexpr float kIntContractRewardPerPoint = 0.04f;
constexpr float kIntContractRewardAsymptote = 0.5f;
constexpr float kIntDocumentRewardPerPoint = 0.06f;
constexpr float kIntDocumentRewardAsymptote = 0.7f;
constexpr float kIntPsiCostEfficiencyPerPoint = 0.035f;

constexpr float kPerCritChancePerPoint = 0.03f;
constexpr float kPerCritChanceAsymptote = 0.35f;
constexpr float kPerAccuracySpreadPerPoint = 0.05f;

std::uint16_t to_e3(float mult) {
    const float scaled = mult * 1000.0f;
    if (!(scaled > 0.0f)) return 0;
    const int r = static_cast<int>(scaled + 0.5f);
    return static_cast<std::uint16_t>(r > 65535 ? 65535 : r);
}

std::uint16_t mul_e3(std::uint16_t a, std::uint16_t b) {
    const std::uint32_t v = (static_cast<std::uint32_t>(a) * static_cast<std::uint32_t>(b) + 500u) / 1000u;
    return static_cast<std::uint16_t>(v > 65535u ? 65535u : v);
}

float linear_mult(std::uint8_t points, float perPoint) {
    return 1.0f + static_cast<float>(points) * perPoint;
}

float inverse_mult(std::uint8_t points, float perPoint) {
    return 1.0f / (1.0f + static_cast<float>(points) * perPoint);
}

float asymptotic_bonus(std::uint8_t points, float perPoint, float asymptote) {
    if (points == 0 || perPoint <= 0.0f || asymptote <= 0.0f) return 0.0f;
    const float p = static_cast<float>(points);
    return asymptote * (1.0f - std::exp(-(p * perPoint) / asymptote));
}

std::uint16_t round_u16(float v) {
    if (!(v > 0.0f)) return 0;
    const int r = static_cast<int>(v + 0.5f);
    return static_cast<std::uint16_t>(r > 65535 ? 65535 : r);
}

// ---------------------------------------------------------------------------
// Static Definitions Tables
// ---------------------------------------------------------------------------
constexpr TraitDef kTraits[kTraitCount] = {
    { TraitId::None, "None", "Нет", "Без особенности", 0, 0, 0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 0, 0 },
    { TraitId::HeavyHanded, "Heavy Handed", "Тяжёлая рука", "+20% к урону в ближнем бою, но -10% к скорости замаха",
      0, 0, 0, 1200, 1111, 1000, 1000, 1000, 1000, 1000, 0, 0 },
    { TraitId::FastMetabolism, "Fast Metabolism", "Быстрый метаболизм", "+30% к эффективности лечения, но +25% к накоплению радиации и жажде",
      0, 0, 0, 1000, 1000, 1000, 1000, 1250, 1000, 1300, 0, 0 },
    { TraitId::Gifted, "Gifted", "Одарённый", "+1 ко всем базовым характеристикам, но -10% к получаемому опыту",
      0, 0, 0, 1000, 1000, 1000, 900, 1000, 1000, 1000, 0, 1 },
    { TraitId::TunnelVision, "Tunnel Vision", "Туннельное зрение", "+15% к кучности стрельбы, но -15% к сектору обнаружения",
      0, 0, 0, 1000, 1000, 1000, 1000, 1000, 850, 1000, 0, 0 },
    { TraitId::ConcreteBlood, "Concrete Blood", "Бетонная кровь", "+20 к максимальному здоровью, но -5% к скорости бега",
      20, 0, 0, 1000, 1000, 950, 1000, 1000, 1000, 1000, 0, 0 },
    { TraitId::PsionicAttuned, "Psionic Attuned", "Пси-резонанс", "+30 к максимальной ПСИ-энергии, но -10% защиты от кинетики",
      0, 30, 0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, -10, 0 },
    { TraitId::PackMule, "Pack Mule", "Вьючный мул", "+16 кг переносимого веса, но -5% к скорости перемещения",
      0, 0, 16000, 1000, 1000, 950, 1000, 1000, 1000, 1000, 0, 0 },
    { TraitId::ChemResistant, "Chem Resistant", "Устойчивость к химии", "Вдвое сниженное привыкание к стимуляторам, но лекарства лечат вдвое слабее",
      0, 0, 0, 1000, 1000, 1000, 1000, 1000, 1000, 500, 0, 0 },
    { TraitId::NightOwl, "Night Owl", "Ночной охотник", "+5% к скорости и обзору в полумраке катакомб",
      0, 0, 0, 1000, 1000, 1050, 1000, 1000, 1050, 1000, 0, 0 },
    { TraitId::Hoarder, "Hoarder", "Барахольщик", "+10% к стоимости сдаваемого хабара, но оружие изнашивается на 10% быстрее",
      0, 0, 0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 0, 0 }
};

constexpr PerkDef kPerks[kPerkCount] = {
    { PerkId::None, "None", "Нет", "Нет", 1, {0,0,0,0,0}, PerkId::None },
    { PerkId::IronGrip, "Iron Grip", "Железный хват", "Устраняет штраф скорости на тяжёлом оружии, +10% к ближнему урону",
      2, {6, 0, 0, 0, 0}, PerkId::None },
    { PerkId::Sprinter, "Sprinter", "Спринтер", "+10% к постоянной скорости бега, снижен расход выносливости",
      2, {0, 6, 0, 0, 0}, PerkId::None },
    { PerkId::LeadBelly, "Lead Belly", "Свинцовый желудок", "Полный иммунитет к радиации от заражённой еды и воды",
      2, {0, 0, 5, 0, 0}, PerkId::None },
    { PerkId::Educated, "Educated", "Эрудит", "+15% к опыту и наградам за документы, +1 очко навыков каждые 3 уровня",
      2, {0, 0, 0, 6, 0}, PerkId::None },
    { PerkId::EagleEye, "Eagle Eye", "Орлиный глаз", "+10% к шансу критического попадания из огнестрельного оружия",
      2, {0, 0, 0, 0, 6}, PerkId::None },
    { PerkId::Gunslinger, "Gunslinger", "Стрелок", "-25% к времени перезарядки, -15% к конусу разброса пуль",
      4, {0, 7, 0, 0, 5}, PerkId::None },
    { PerkId::Toughness, "Toughness", "Крепкий орешек", "+25 к максимальному здоровью, +5% к защите от всех типов урона",
      4, {0, 0, 6, 0, 0}, PerkId::None },
    { PerkId::Pyromaniac, "Pyromaniac", "Пироман", "+25% к урону огнём и зажигательными смесями, защита от ожогов",
      4, {0, 0, 0, 5, 0}, PerkId::None },
    { PerkId::SilentStep, "Silent Step", "Бесшумный шаг", "Шум шагов снижен на 50%, враги реагируют с задержкой",
      4, {0, 7, 0, 0, 0}, PerkId::None },
    { PerkId::CyberneticAffinity, "Cyber Affinity", "Кибер-сродство", "Устраняет отторжение имплантов, износ имплантов снижен на 50%",
      6, {0, 0, 5, 7, 0}, PerkId::None },
    { PerkId::PsiOverload, "Psi Overload", "Пси-перегрузка", "Критические удары вызывают волну пси-детонации по области",
      6, {0, 0, 0, 8, 0}, PerkId::None },
    { PerkId::SamosborSurvivor, "Samosbor Survivor", "Ветеран Самосбора", "-50% урона от тумана и пси-давления Самосбора",
      8, {0, 0, 8, 0, 0}, PerkId::None }
};

constexpr BioMutationDef kBioMutations[kBioMutationCount] = {
    { BioMutationId::None, "None", "Нет", "Нет", "Нет", 0, 0, 0, 1000, 1000, 0, 0, 0, 0 },
    { BioMutationId::ChitinousPlates, "Chitinous Plates", "Хитиновый панцирь",
      "+25% к защите от пуль и осколков, +20 Max HP", "-20% к скорости перемещения, броня весит на 50% больше",
      20, 0, 0, 1000, 800, 25, 0, 0, 0 },
    { BioMutationId::HypertrophiedMuscles, "Hypertrophied Muscles", "Гипертрофия мышц",
      "+35% к урону в ближнем бою, +16 кг грузоподъёмности", "-3 к Интеллекту, расход еды увеличен на 50%",
      0, 0, 16000, 1350, 1000, 0, 0, 0, 0 },
    { BioMutationId::ThirdEye, "Third Eye", "Третий глаз",
      "+3 к Восприятию, +35 к Max PSI, обнаружение существ сквозь стены", "-20% к защите от огня, светобоязнь",
      0, 35, 0, 1000, 1000, 0, -20, 0, 0 },
    { BioMutationId::AcidicBlood, "Acidic Blood", "Едкая кровь",
      "Атакующие в упор получают 15 ед. урона кислотой", "Кровотечение наносит удвоенный урон, медицина слабее на 30%",
      0, 0, 0, 1000, 1000, 0, 0, 40, 0 },
    { BioMutationId::GillsOfGigahrush, "Gills of Gigahrush", "Жабры Гигахруща",
      "Иммунитет к удушью и споровому туману, расход воды снижен", "Урон от огня увеличен в 1.5 раза, -10 Max HP",
      -10, 0, 0, 1000, 1000, 0, -50, 0, 80 },
    { BioMutationId::SporeSymbiosis, "Spore Symbiosis", "Споровый симбиоз",
      "Регенерация 1 HP каждые 3 секунды рядом с биомассой", "Постоянный кашель говняка, антибиотики не действуют",
      0, 0, 0, 1000, 1000, 0, 0, 0, 0 },
    { BioMutationId::BoneClaws, "Bone Claws", "Костяные наросты",
      "Удары кулаками наносят +25 урона и вызывают разрыв плоти", "Штраф к обращению с точным огнестрельным оружием",
      0, 0, 0, 1250, 1000, 0, 0, 0, 0 },
    { BioMutationId::AdrenalineGland, "Adrenaline Gland", "Аномальный надпочечник",
      "При HP < 30%: +50% к скорости бега и +30% к скорости атак", "-20 к Max PSI, повышенная утомляемость",
      0, -20, 0, 1000, 1000, 0, 0, 0, 0 }
};

constexpr ImplantDef kImplants[kImplantCount] = {
    { ImplantId::None, ImplantSlot::Cranial, "None", "Нет", "Нет", 1000, {0,0,0,0,0}, 0, 0, 1000, 1000, 0, 0, 0, 0 },
    { ImplantId::NeuralCoProcessor, ImplantSlot::Cranial, "Neural Co-Processor", "Нейросопроцессор «Искра-М»",
      "+4 Интеллект, -20% стоимость ПСИ, +15% к опыту", 1000, {0, 0, 0, 4, 0}, 0, 20, 1000, 1000, 0, 0, 0, 0 },
    { ImplantId::BionicEyeThermal, ImplantSlot::Ocular, "Thermal Bionic Eye", "Тепловизионный окуляр «Сова-2»",
      "+3 Восприятие, подсветка замаскированных целей, +15% крит", 1000, {0, 0, 0, 0, 3}, 0, 0, 1000, 1000, 0, 0, 0, 0 },
    { ImplantId::CardioFilterPump, ImplantSlot::Thoracic, "Cardio Filter Pump", "Кардиофильтр «Озон-8»",
      "+3 Выносливость, +40% защита от газов, снижен расход сил", 1000, {0, 0, 3, 0, 0}, 15, 0, 1000, 1000, 0, 40, 0, 0 },
    { ImplantId::HydraulicArmServo, ImplantSlot::ArmRight, "Hydraulic Arm Servo", "Гидравлический привод плеча",
      "+4 Сила, +35% урон в ближнем бою, гашение отдачи", 1000, {4, 0, 0, 0, 0}, 0, 0, 1350, 1000, 0, 0, 0, 0 },
    { ImplantId::PneumaticLegActuators, ImplantSlot::LegLeft, "Pneumatic Leg Actuators", "Пневмоприводы стопы",
      "+20% скорость бега, +50% высота прыжка, -50% урон от падения", 1000, {0, 3, 0, 0, 0}, 0, 0, 1000, 1200, 0, 0, 0, 0 },
    { ImplantId::SubdermalArmorPlating, ImplantSlot::Subdermal, "Subdermal Plating", "Подкожные титановые соты",
      "+15% поглощение любого урона, +25 Max HP", 1000, {0, 0, 2, 0, 0}, 25, 0, 1000, 1000, 15, 0, 0, 0 },
    { ImplantId::PsiEmitterRelay, ImplantSlot::Cranial, "Psi Emitter Relay", "Пси-излучатель «Реле-4»",
      "+40 Max PSI, расширяет радиус действия телепатических импульсов", 1000, {0, 0, 0, 2, 2}, 0, 40, 1000, 1000, 0, 0, 0, 0 },
    { ImplantId::DermalInsulator, ImplantSlot::Subdermal, "Dermal Insulator", "Дермальный изолятор «Слюда»",
      "+25% защита от электричества и огня, защита от шока", 1000, {0, 0, 1, 0, 0}, 0, 0, 1000, 1000, 0, 0, 25, 25 }
};

std::uint32_t monster_base_xp(MobKind kind) {
    switch (kind) {
        case MobKind::Sborka:            return 10;
        case MobKind::Tvar:              return 50;
        case MobKind::Polzun:            return 100;
        case MobKind::Betonnik:          return 240;
        case MobKind::Betonoed:          return 130;
        case MobKind::Zombie:            return 14;
        case MobKind::DikiyMertvyak:     return 16;
        case MobKind::Eye:               return 35;
        case MobKind::Nightmare:         return 90;
        case MobKind::Shadow:            return 70;
        case MobKind::TonkayaTen:        return 58;
        case MobKind::Rebar:             return 110;
        case MobKind::Matka:             return 300;
        case MobKind::KhorovayaMatka:    return 380;
        case MobKind::Sobrannyy:         return 220;
        case MobKind::Mancobus:          return 400;
        case MobKind::Herald:            return 360;
        case MobKind::Creator:           return 10000;
        case MobKind::Spirit:            return 80;
        case MobKind::LozhnyyDukh:       return 95;
        case MobKind::Idol:              return 20;
        case MobKind::Robot:             return 70;
        case MobKind::TrubnyyAvtomat:    return 150;
        case MobKind::Shovnik:           return 64;
        case MobKind::Lampovy:           return 56;
        case MobKind::Lampoglaz:         return 84;
        case MobKind::Pechateed:         return 76;
        case MobKind::Paragraph:         return 90;
        case MobKind::Nelyud:            return 140;
        case MobKind::Krysnozhka:        return 48;
        case MobKind::GreenDog:          return 72;
        case MobKind::Kostorez:          return 190;
        case MobKind::Safeguard:         return 250;
        case MobKind::Rzhavnik:          return 70;
        case MobKind::Olgoy:             return 170;
        default:                         return 10;
    }
}

std::uint32_t scale_kill_xp(std::uint32_t base, std::uint8_t level) {
    const std::uint8_t lv = level < 1 ? 1 : level;
    const float v = static_cast<float>(base) *
                    (1.0f + 0.22f * (static_cast<float>(lv) - 1.0f));
    const float r = v + 0.5f;
    return r > 4294967040.0f ? 4294967040u : static_cast<std::uint32_t>(r);
}

void credit_max_hp_gain(const RpgStats& r, std::int16_t* hp, std::int16_t* maxHp) {
    if (maxHp == nullptr) return;
    const std::int16_t newMax = static_cast<std::int16_t>(max_hp(r));
    const int diff = static_cast<int>(newMax) - static_cast<int>(*maxHp);
    *maxHp = newMax;
    if (hp == nullptr) return;
    const int gain = diff > 0 ? diff : 0;
    const int raised = static_cast<int>(*hp) + gain;
    *hp = static_cast<std::int16_t>(raised > newMax ? newMax : raised);
}

} // namespace

// ---------------------------------------------------------------------------
// RAW & EFFECTIVE ATTRIBUTES
// ---------------------------------------------------------------------------
std::uint8_t raw_attr_of(const RpgStats& r, Attr a) {
    const auto slot = static_cast<std::size_t>(a);
    return slot < kAttrCount ? r.attr[slot] : static_cast<std::uint8_t>(0);
}

std::uint8_t effective_attr_of(const RpgStats& r, Attr a) {
    const auto slot = static_cast<std::size_t>(a);
    if (slot >= kAttrCount) return 0;
    int val = static_cast<int>(r.attr[slot]);

    // Gifted trait (+1 all)
    if (has_trait(r, TraitId::Gifted)) {
        val += 1;
    }

    // Bio-mutations
    if (a == Attr::Int && has_mutation(r, BioMutationId::HypertrophiedMuscles)) {
        val -= 3;
    }
    if (a == Attr::Per && has_mutation(r, BioMutationId::ThirdEye)) {
        val += 3;
    }

    // Cybernetic implants (only functioning)
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            const auto& idf = implant_def(static_cast<ImplantId>(r.implantId[s]));
            val += idf.attrBonus[slot];
        }
    }

    if (val < 0) return 0;
    return static_cast<std::uint8_t>(val > kRpgAttributeCap ? kRpgAttributeCap : val);
}

// ---------------------------------------------------------------------------
// Trait & Perk APIs
// ---------------------------------------------------------------------------
const TraitDef& trait_def(TraitId id) {
    const auto idx = static_cast<std::size_t>(id);
    return idx < kTraitCount ? kTraits[idx] : kTraits[0];
}

bool has_trait(const RpgStats& r, TraitId id) {
    if (id == TraitId::None || id >= TraitId::Count) return false;
    return (r.traitMask & (1u << static_cast<std::uint32_t>(id))) != 0;
}

bool add_trait(RpgStats& r, TraitId id) {
    if (id == TraitId::None || id >= TraitId::Count) return false;
    r.traitMask |= (1u << static_cast<std::uint32_t>(id));
    return true;
}

bool remove_trait(RpgStats& r, TraitId id) {
    if (id == TraitId::None || id >= TraitId::Count) return false;
    r.traitMask &= ~(1u << static_cast<std::uint32_t>(id));
    return true;
}

const PerkDef& perk_def(PerkId id) {
    const auto idx = static_cast<std::size_t>(id);
    return idx < kPerkCount ? kPerks[idx] : kPerks[0];
}

bool perk_prerequisites_met(const RpgStats& r, PerkId id) {
    if (id == PerkId::None || id >= PerkId::Count) return false;
    const PerkDef& def = perk_def(id);
    if (r.level < def.minLevel) return false;
    for (std::size_t a = 0; a < kAttrCount; ++a) {
        if (effective_attr_of(r, static_cast<Attr>(a)) < def.minAttr[a]) return false;
    }
    if (def.requiredPerk != PerkId::None && !has_perk(r, def.requiredPerk)) return false;
    return true;
}

bool has_perk(const RpgStats& r, PerkId id) {
    if (id == PerkId::None || id >= PerkId::Count) return false;
    return (r.perkMask & (1u << static_cast<std::uint32_t>(id))) != 0;
}

bool unlock_perk(RpgStats& r, PerkId id) {
    if (id == PerkId::None || id >= PerkId::Count) return false;
    if (r.perkPoints == 0) return false;
    if (has_perk(r, id)) return false;
    if (!perk_prerequisites_met(r, id)) return false;
    --r.perkPoints;
    r.perkMask |= (1u << static_cast<std::uint32_t>(id));
    return true;
}

// ---------------------------------------------------------------------------
// Bio-Mutation APIs
// ---------------------------------------------------------------------------
const BioMutationDef& bio_mutation_def(BioMutationId id) {
    const auto idx = static_cast<std::size_t>(id);
    return idx < kBioMutationCount ? kBioMutations[idx] : kBioMutations[0];
}

bool has_mutation(const RpgStats& r, BioMutationId id) {
    if (id == BioMutationId::None || id >= BioMutationId::Count) return false;
    return (r.mutationMask & (1u << static_cast<std::uint32_t>(id))) != 0;
}

bool apply_mutation(RpgStats& r, BioMutationId id, std::int16_t* hp, std::int16_t* maxHp) {
    if (id == BioMutationId::None || id >= BioMutationId::Count) return false;
    if (has_mutation(r, id)) return false;
    r.mutationMask |= (1u << static_cast<std::uint32_t>(id));
    credit_max_hp_gain(r, hp, maxHp);
    r.psi = max_psi(r);
    return true;
}

bool remove_mutation(RpgStats& r, BioMutationId id, std::int16_t* hp, std::int16_t* maxHp) {
    if (id == BioMutationId::None || id >= BioMutationId::Count) return false;
    if (!has_mutation(r, id)) return false;
    r.mutationMask &= ~(1u << static_cast<std::uint32_t>(id));
    credit_max_hp_gain(r, hp, maxHp);
    const std::uint16_t psiCap = max_psi(r);
    if (r.psi > psiCap) r.psi = psiCap;
    return true;
}

BioMutationId roll_random_mutation(const RpgStats& r, std::uint32_t seed) {
    BioMutationId candidates[kBioMutationCount];
    std::size_t count = 0;
    for (std::size_t i = 1; i < kBioMutationCount; ++i) {
        const auto mid = static_cast<BioMutationId>(i);
        if (!has_mutation(r, mid)) {
            candidates[count++] = mid;
        }
    }
    if (count == 0) return BioMutationId::None;
    const std::uint32_t pick = hash_u32(seed) % count;
    return candidates[pick];
}

void add_radiation_dose(RpgStats& r, std::uint16_t mSv, std::uint32_t seed,
                        std::int16_t* hp, std::int16_t* maxHp) {
    if (mSv == 0) return;
    float effectiveDose = static_cast<float>(mSv);
    if (has_trait(r, TraitId::FastMetabolism)) {
        effectiveDose *= 1.25f; // +25% rad sensitivity
    }
    const float radResist = static_cast<float>(end_radiation_resist_e3(r)) / 1000.0f;
    effectiveDose *= (1.0f - radResist);
    if (effectiveDose < 0.0f) effectiveDose = 0.0f;

    const std::uint32_t doseInc = static_cast<std::uint32_t>(effectiveDose + 0.5f);
    const std::uint32_t oldDose = r.radDose;
    const std::uint32_t nextDose = oldDose + doseInc;
    r.radDose = nextDose > 65535u ? 65535u : static_cast<std::uint16_t>(nextDose);

    // Every 250 mSv triggers mutation adaptation roll
    const std::uint32_t oldThreshold = oldDose / 250u;
    const std::uint32_t newThreshold = r.radDose / 250u;
    if (newThreshold > oldThreshold) {
        const std::uint32_t numRolls = newThreshold - oldThreshold;
        for (std::uint32_t i = 0; i < numRolls; ++i) {
            const BioMutationId rolled = roll_random_mutation(r, seed ^ (r.radDose + i * 37u));
            if (rolled != BioMutationId::None) {
                apply_mutation(r, rolled, hp, maxHp);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Augmentation / Cybernetic Implant APIs
// ---------------------------------------------------------------------------
const ImplantDef& implant_def(ImplantId id) {
    const auto idx = static_cast<std::size_t>(id);
    return idx < kImplantCount ? kImplants[idx] : kImplants[0];
}

bool implant_is_functioning(const RpgStats& r, ImplantSlot slot) {
    const auto s = static_cast<std::size_t>(slot);
    if (s >= kImplantSlotCount) return false;
    return r.implantId[s] != 0 && r.implantDurability[s] > 0;
}

bool implant_install(RpgStats& r, ImplantSlot slot, ImplantId id,
                     std::int16_t* hp, std::int16_t* maxHp) {
    const auto s = static_cast<std::size_t>(slot);
    if (s >= kImplantSlotCount) return false;
    if (id == ImplantId::None || id >= ImplantId::Count) return false;
    const ImplantDef& def = implant_def(id);
    if (def.slot != slot) {
        const bool armMatch = (def.slot == ImplantSlot::ArmRight || def.slot == ImplantSlot::ArmLeft) &&
                              (slot == ImplantSlot::ArmRight || slot == ImplantSlot::ArmLeft);
        const bool legMatch = (def.slot == ImplantSlot::LegLeft || def.slot == ImplantSlot::LegRight) &&
                              (slot == ImplantSlot::LegLeft || slot == ImplantSlot::LegRight);
        if (!armMatch && !legMatch) return false;
    }

    r.implantId[s] = static_cast<std::uint8_t>(id);
    r.implantDurability[s] = def.maxDurability;
    credit_max_hp_gain(r, hp, maxHp);
    r.psi = max_psi(r);
    return true;
}

bool implant_uninstall(RpgStats& r, ImplantSlot slot,
                       std::int16_t* hp, std::int16_t* maxHp) {
    const auto s = static_cast<std::size_t>(slot);
    if (s >= kImplantSlotCount) return false;
    if (r.implantId[s] == 0) return false;

    r.implantId[s] = 0;
    r.implantDurability[s] = 0;
    credit_max_hp_gain(r, hp, maxHp);
    const std::uint16_t psiCap = max_psi(r);
    if (r.psi > psiCap) r.psi = psiCap;
    return true;
}

bool implant_repair(RpgStats& r, ImplantSlot slot, std::uint16_t repairPoints) {
    const auto s = static_cast<std::size_t>(slot);
    if (s >= kImplantSlotCount || r.implantId[s] == 0) return false;
    const ImplantDef& def = implant_def(static_cast<ImplantId>(r.implantId[s]));
    const std::uint32_t cur = r.implantDurability[s];
    const std::uint32_t next = cur + repairPoints;
    r.implantDurability[s] = static_cast<std::uint16_t>(next > def.maxDurability ? def.maxDurability : next);
    return true;
}

void implant_degrade_step(RpgStats& r, float dtSec) {
    if (dtSec <= 0.0f) return;
    const bool cyberAffinity = has_perk(r, PerkId::CyberneticAffinity);
    const float drainScale = cyberAffinity ? 0.5f : 1.0f;
    const std::uint16_t loss = static_cast<std::uint16_t>(std::max(1.0f, dtSec * drainScale * 0.1f));

    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (r.implantId[s] != 0 && r.implantDurability[s] > 0) {
            if (r.implantDurability[s] <= loss) r.implantDurability[s] = 0;
            else r.implantDurability[s] -= loss;
        }
    }
}

void implant_take_damage(RpgStats& r, std::int16_t dmg, std::uint8_t damageChannel) {
    (void)damageChannel;
    if (dmg <= 0) return;
    const bool cyberAffinity = has_perk(r, PerkId::CyberneticAffinity);
    const int wear = cyberAffinity ? (dmg / 4 + 1) : (dmg / 2 + 1);

    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (r.implantId[s] != 0 && r.implantDurability[s] > 0) {
            if (r.implantDurability[s] <= wear) r.implantDurability[s] = 0;
            else r.implantDurability[s] -= static_cast<std::uint16_t>(wear);
        }
    }
}

// ---------------------------------------------------------------------------
// Basic Level and XP curves
// ---------------------------------------------------------------------------
std::uint8_t clamp_rpg_level(int level) {
    if (level < 1) return 1;
    return static_cast<std::uint8_t>(level > kRpgLevelCap ? kRpgLevelCap : level);
}

std::uint8_t clamp_rpg_attribute(int points) {
    if (points < 0) return 0;
    return static_cast<std::uint8_t>(points > kRpgAttributeCap ? kRpgAttributeCap : points);
}

std::uint32_t xp_for_level(std::uint8_t level) {
    if (level <= 1) return 0;
    const std::uint32_t rank = static_cast<std::uint32_t>(level) - 1u;
    return 75u + 25u * rank + 10u * rank * (rank - 1u);
}

std::uint64_t total_xp_for_level(std::uint8_t level) {
    std::uint64_t total = 0;
    for (std::uint32_t i = 1; i <= static_cast<std::uint32_t>(level); ++i)
        total += xp_for_level(static_cast<std::uint8_t>(i));
    return total;
}

std::uint16_t level_hp(std::uint8_t level) {
    const std::uint8_t lv = clamp_rpg_level(level);
    return static_cast<std::uint16_t>(kBaseHp + kHpPerLevel * (lv - 1));
}

std::uint16_t level_psi(std::uint8_t level) {
    const std::uint8_t lv = clamp_rpg_level(level);
    return static_cast<std::uint16_t>(kBasePsi + kPsiPerLevel * (lv - 1));
}

std::uint32_t carry_capacity_g(const RpgStats& r) {
    std::uint32_t cap = kCarryBaseG +
                        kCarryPerStrG * static_cast<std::uint32_t>(effective_attr_of(r, Attr::Str)) +
                        kCarryPerEndG * static_cast<std::uint32_t>(effective_attr_of(r, Attr::End));

    // Trait modifiers
    for (std::size_t i = 1; i < kTraitCount; ++i) {
        const auto tid = static_cast<TraitId>(i);
        if (has_trait(r, tid)) {
            const auto& td = trait_def(tid);
            if (td.carryBonusG > 0) cap += static_cast<std::uint32_t>(td.carryBonusG);
        }
    }

    // Bio-mutation modifiers
    for (std::size_t i = 1; i < kBioMutationCount; ++i) {
        const auto mid = static_cast<BioMutationId>(i);
        if (has_mutation(r, mid)) {
            const auto& md = bio_mutation_def(mid);
            if (md.carryBonusG > 0) cap += static_cast<std::uint32_t>(md.carryBonusG);
        }
    }

    return cap;
}

std::uint16_t max_hp(const RpgStats& r) {
    const float base = static_cast<float>(level_hp(r.level));
    const float strFactor = linear_mult(effective_attr_of(r, Attr::Str), kStrHpPerPoint);
    const float endFactor = linear_mult(effective_attr_of(r, Attr::End), kEndHpPerPoint);
    float val = base * strFactor * endFactor;

    // Traits
    for (std::size_t i = 1; i < kTraitCount; ++i) {
        const auto tid = static_cast<TraitId>(i);
        if (has_trait(r, tid)) val += static_cast<float>(trait_def(tid).hpBonus);
    }
    // Perks
    if (has_perk(r, PerkId::Toughness)) val += 25.0f;

    // Mutations
    for (std::size_t i = 1; i < kBioMutationCount; ++i) {
        const auto mid = static_cast<BioMutationId>(i);
        if (has_mutation(r, mid)) val += static_cast<float>(bio_mutation_def(mid).hpBonus);
    }
    // Implants
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            const auto& idf = implant_def(static_cast<ImplantId>(r.implantId[s]));
            val += static_cast<float>(idf.hpBonus);
        }
    }

    return round_u16(val > 1.0f ? val : 1.0f);
}

std::uint16_t max_psi(const RpgStats& r) {
    const float base = static_cast<float>(level_psi(r.level));
    const float intFactor = linear_mult(effective_attr_of(r, Attr::Int), kIntPsiPerPoint);
    float val = base * intFactor;

    // Traits
    for (std::size_t i = 1; i < kTraitCount; ++i) {
        const auto tid = static_cast<TraitId>(i);
        if (has_trait(r, tid)) val += static_cast<float>(trait_def(tid).psiBonus);
    }
    // Mutations
    for (std::size_t i = 1; i < kBioMutationCount; ++i) {
        const auto mid = static_cast<BioMutationId>(i);
        if (has_mutation(r, mid)) val += static_cast<float>(bio_mutation_def(mid).psiBonus);
    }
    // Implants
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            const auto& idf = implant_def(static_cast<ImplantId>(r.implantId[s]));
            val += static_cast<float>(idf.psiBonus);
        }
    }

    return round_u16(val > 1.0f ? val : 1.0f);
}

RpgStats fresh_rpg(std::uint8_t level) {
    RpgStats r;
    r.level = clamp_rpg_level(level);
    r.psi = max_psi(r);
    return r;
}

RpgStats random_rpg(std::uint8_t level, std::uint32_t seed) {
    RpgStats r;
    r.level = clamp_rpg_level(level);
    const std::uint32_t points = static_cast<std::uint32_t>(r.level) - 1u;
    for (std::uint32_t i = 0; i < points; ++i) {
        const float x = rand01(hash2(seed, i));
        const std::size_t slot = static_cast<std::size_t>(x * static_cast<float>(kAttrCount));
        const std::size_t safeSlot = slot < kAttrCount ? slot : 0u;
        if (r.attr[safeSlot] < kRpgAttributeCap) ++r.attr[safeSlot];
    }
    r.psi = max_psi(r);
    return r;
}

// ---------------------------------------------------------------------------
// Derived Stat Multipliers
// ---------------------------------------------------------------------------
std::uint16_t str_melee_dmg_mult_e3(const RpgStats& r) {
    std::uint16_t acc = to_e3(linear_mult(effective_attr_of(r, Attr::Str), kStrMeleeDamagePerPoint));
    for (std::size_t i = 1; i < kTraitCount; ++i) {
        const auto tid = static_cast<TraitId>(i);
        if (has_trait(r, tid)) acc = mul_e3(acc, static_cast<std::uint16_t>(trait_def(tid).meleeMultE3));
    }
    if (has_perk(r, PerkId::IronGrip)) acc = mul_e3(acc, 1100);
    for (std::size_t i = 1; i < kBioMutationCount; ++i) {
        const auto mid = static_cast<BioMutationId>(i);
        if (has_mutation(r, mid)) acc = mul_e3(acc, static_cast<std::uint16_t>(bio_mutation_def(mid).meleeMultE3));
    }
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            acc = mul_e3(acc, static_cast<std::uint16_t>(implant_def(static_cast<ImplantId>(r.implantId[s])).meleeMultE3));
        }
    }
    return acc;
}

std::uint16_t str_durability_wear_mult_e3(const RpgStats& r) {
    std::uint16_t acc = to_e3(inverse_mult(effective_attr_of(r, Attr::Str), kStrDurabilityWearPerPoint));
    if (has_trait(r, TraitId::Hoarder)) acc = mul_e3(acc, 1100);
    return acc;
}

bool rpg_adrenaline_active(const RpgStats& r, std::int16_t hp, std::int16_t maxHp) {
    if (!has_mutation(r, BioMutationId::AdrenalineGland)) return false;
    if (hp <= 0 || maxHp <= 0) return false;
    return (static_cast<int>(hp) * 100) < (static_cast<int>(maxHp) * 30);
}

std::uint16_t agi_move_speed_mult_e3(const RpgStats& r, std::int16_t hp, std::int16_t maxHp) {
    std::uint16_t acc = to_e3(linear_mult(effective_attr_of(r, Attr::Agi), kAgiMoveSpeedPerPoint));
    for (std::size_t i = 1; i < kTraitCount; ++i) {
        const auto tid = static_cast<TraitId>(i);
        if (has_trait(r, tid)) acc = mul_e3(acc, static_cast<std::uint16_t>(trait_def(tid).moveSpeedMultE3));
    }
    if (has_perk(r, PerkId::Sprinter)) acc = mul_e3(acc, 1100);
    for (std::size_t i = 1; i < kBioMutationCount; ++i) {
        const auto mid = static_cast<BioMutationId>(i);
        if (has_mutation(r, mid)) acc = mul_e3(acc, static_cast<std::uint16_t>(bio_mutation_def(mid).moveSpeedMultE3));
    }
    if (rpg_adrenaline_active(r, hp, maxHp)) {
        acc = mul_e3(acc, 1500); // Low HP (<30%) Adrenaline Gland boost: +50% speed
    }
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            acc = mul_e3(acc, static_cast<std::uint16_t>(implant_def(static_cast<ImplantId>(r.implantId[s])).moveMultE3));
        }
    }
    return acc;
}

std::uint16_t agi_attack_speed_mult_e3(const RpgStats& r, std::int16_t hp, std::int16_t maxHp) {
    std::uint16_t acc = to_e3(inverse_mult(effective_attr_of(r, Attr::Agi), kAgiAttackCooldownPerPoint));
    for (std::size_t i = 1; i < kTraitCount; ++i) {
        const auto tid = static_cast<TraitId>(i);
        if (has_trait(r, tid)) acc = mul_e3(acc, static_cast<std::uint16_t>(trait_def(tid).attackSpeedMultE3));
    }
    if (rpg_adrenaline_active(r, hp, maxHp)) {
        acc = mul_e3(acc, 700); // Low HP (<30%) Adrenaline Gland boost: +30% attack speed (reduced cooldown)
    }
    return acc;
}

std::uint16_t agi_ranged_spread_mult_e3(const RpgStats& r) {
    std::uint16_t acc = to_e3(inverse_mult(effective_attr_of(r, Attr::Agi), kAgiSpreadPerPoint));
    if (has_perk(r, PerkId::Gunslinger)) acc = mul_e3(acc, 850);
    if (has_mutation(r, BioMutationId::BoneClaws)) acc = mul_e3(acc, 1150); // delicate firearm handling penalty
    return acc;
}

std::uint16_t agi_dodge_chance_e3(const RpgStats& r) {
    return to_e3(asymptotic_bonus(effective_attr_of(r, Attr::Agi), kAgiDodgePerPoint, kAgiDodgeAsymptote));
}

std::uint16_t end_max_hp_mult_e3(const RpgStats& r) {
    return to_e3(linear_mult(effective_attr_of(r, Attr::End), kEndHpPerPoint));
}

std::uint16_t end_radiation_resist_e3(const RpgStats& r) {
    float bonus = asymptotic_bonus(effective_attr_of(r, Attr::End), kEndRadResistPerPoint, kEndRadResistAsymptote);
    if (has_perk(r, PerkId::LeadBelly)) bonus += 0.35f;
    return to_e3(bonus > 0.95f ? 0.95f : bonus);
}

std::uint16_t end_stamina_drain_mult_e3(const RpgStats& r) {
    std::uint16_t acc = to_e3(inverse_mult(effective_attr_of(r, Attr::End), kEndStaminaDrainPerPoint));
    if (has_perk(r, PerkId::Sprinter)) acc = mul_e3(acc, 850);
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            if (r.implantId[s] == static_cast<std::uint8_t>(ImplantId::CardioFilterPump)) {
                acc = mul_e3(acc, 700); // -30% stamina drain
            }
        }
    }
    return acc;
}

std::uint16_t int_xp_mult_e3(const RpgStats& r) {
    float bonus = asymptotic_bonus(effective_attr_of(r, Attr::Int), kIntXpBonusPerPoint, kIntXpBonusAsymptote);
    std::uint16_t acc = to_e3(1.0f + bonus);
    for (std::size_t i = 1; i < kTraitCount; ++i) {
        const auto tid = static_cast<TraitId>(i);
        if (has_trait(r, tid)) acc = mul_e3(acc, static_cast<std::uint16_t>(trait_def(tid).xpMultE3));
    }
    if (has_perk(r, PerkId::Educated)) acc = mul_e3(acc, 1150);
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            if (r.implantId[s] == static_cast<std::uint8_t>(ImplantId::NeuralCoProcessor)) {
                acc = mul_e3(acc, 1150);
            }
        }
    }
    return acc;
}

std::uint16_t int_psi_cost_mult_e3(const RpgStats& r) {
    std::uint16_t acc = to_e3(inverse_mult(effective_attr_of(r, Attr::Int), kIntPsiCostEfficiencyPerPoint));
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            if (r.implantId[s] == static_cast<std::uint8_t>(ImplantId::NeuralCoProcessor)) {
                acc = mul_e3(acc, 800); // -20% PSI cost
            }
        }
    }
    return acc;
}

std::uint16_t int_contract_reward_mult_e3(const RpgStats& r) {
    std::uint16_t acc = to_e3(1.0f + asymptotic_bonus(effective_attr_of(r, Attr::Int), kIntContractRewardPerPoint, kIntContractRewardAsymptote));
    if (has_trait(r, TraitId::Hoarder)) acc = mul_e3(acc, 1100);
    return acc;
}

std::uint16_t int_document_reward_mult_e3(const RpgStats& r) {
    float bonus = asymptotic_bonus(effective_attr_of(r, Attr::Int), kIntDocumentRewardPerPoint, kIntDocumentRewardAsymptote);
    if (has_perk(r, PerkId::Educated)) bonus += 0.15f;
    std::uint16_t acc = to_e3(1.0f + bonus);
    if (has_trait(r, TraitId::Hoarder)) acc = mul_e3(acc, 1100);
    return acc;
}

std::uint16_t int_hack_success_mult_e3(const RpgStats& r) {
    return to_e3(linear_mult(effective_attr_of(r, Attr::Int), 0.05f));
}

std::uint16_t int_psi_duration_bonus_sec(const RpgStats& r) {
    return static_cast<std::uint16_t>(static_cast<float>(effective_attr_of(r, Attr::Int)) * kIntPsiDurationSecPerPoint);
}

std::uint16_t per_crit_chance_e3(const RpgStats& r) {
    float bonus = asymptotic_bonus(effective_attr_of(r, Attr::Per), kPerCritChancePerPoint, kPerCritChanceAsymptote);
    if (has_perk(r, PerkId::EagleEye)) bonus += 0.10f;
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            if (r.implantId[s] == static_cast<std::uint8_t>(ImplantId::BionicEyeThermal)) {
                bonus += 0.15f;
            }
        }
    }
    return to_e3(bonus);
}

float per_detection_range_m(const RpgStats& r) {
    float range = 10.0f + static_cast<float>(effective_attr_of(r, Attr::Per)) * 0.5f;
    if (has_trait(r, TraitId::TunnelVision)) range *= 0.85f;
    if (has_trait(r, TraitId::NightOwl))     range *= 1.10f;
    if (has_perk(r, PerkId::EagleEye))       range += 5.0f;
    if (has_mutation(r, BioMutationId::ThirdEye)) range += 8.0f;
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            if (r.implantId[s] == static_cast<std::uint8_t>(ImplantId::BionicEyeThermal)) {
                range += 5.0f;
            }
        }
    }
    return range;
}

std::uint16_t per_ranged_accuracy_mult_e3(const RpgStats& r) {
    std::uint16_t acc = to_e3(inverse_mult(effective_attr_of(r, Attr::Per), kPerAccuracySpreadPerPoint));
    if (has_trait(r, TraitId::TunnelVision)) acc = mul_e3(acc, 850);
    return acc;
}

std::uint16_t str_heavy_weapon_speed_mult_e3(const RpgStats& r, std::uint16_t baseCooldownMs) {
    if (baseCooldownMs < kHeavyWeaponCooldownMs) return 1000;
    if (has_perk(r, PerkId::IronGrip)) return 500;
    return to_e3(inverse_mult(effective_attr_of(r, Attr::Str), kStrHeavyWeaponSpeedPerPoint));
}

std::int16_t melee_damage(const RpgStats& r, ItemId weaponId, std::int16_t weaponDamage) {
    const int levelBonus = static_cast<int>(r.level) - 1;
    int base;
    if (weaponId != 0) {
        const int wd = weaponDamage > 0 ? static_cast<int>(weaponDamage) : 0;
        base = wd + levelBonus;
    } else {
        base = r.level < 1 ? 1 : static_cast<int>(r.level);
        if (has_mutation(r, BioMutationId::BoneClaws)) base += 25;
    }
    const float scaled = static_cast<float>(base) *
                         (static_cast<float>(str_melee_dmg_mult_e3(r)) / 1000.0f);
    const int out = static_cast<int>(scaled + 0.5f);
    return static_cast<std::int16_t>(out > 32767 ? 32767 : (out < 0 ? 0 : out));
}

std::uint16_t adjusted_psi_cost(std::uint16_t baseCost, const RpgStats& r) {
    if (baseCost == 0) return 0;
    const float mult = static_cast<float>(int_psi_cost_mult_e3(r)) / 1000.0f;
    const float v = static_cast<float>(baseCost) * mult;
    const std::uint16_t out = round_u16(v);
    return out < 1 ? 1 : out;
}

std::int16_t rpg_damage_resistance_pct(const RpgStats& r, std::uint8_t damageChannel) {
    int resist = 0;

    // All channels: Toughness perk (+5%), Subdermal Plating implant (+15%)
    if (has_perk(r, PerkId::Toughness)) {
        resist += 5;
    }
    for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
        if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
            const auto& idf = implant_def(static_cast<ImplantId>(r.implantId[s]));
            resist += idf.damageMitigatePct;
        }
    }

    // Specific damage channels: 0=Kinetic, 1=Buckshot, 2=Energy, 3=Fire, 4=Psi
    switch (damageChannel) {
        case 0: // Kinetic
            if (has_trait(r, TraitId::PsionicAttuned)) resist -= 10;
            if (has_mutation(r, BioMutationId::ChitinousPlates)) resist += 25;
            break;
        case 1: // Buckshot
            if (has_trait(r, TraitId::PsionicAttuned)) resist -= 10;
            if (has_mutation(r, BioMutationId::ChitinousPlates)) resist += 25;
            break;
        case 2: // Energy
            for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
                if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
                    const auto& idf = implant_def(static_cast<ImplantId>(r.implantId[s]));
                    resist += idf.energyResistPct;
                }
            }
            break;
        case 3: // Fire
            if (has_perk(r, PerkId::Pyromaniac)) resist += 20;
            if (has_mutation(r, BioMutationId::ThirdEye)) resist -= 20;
            if (has_mutation(r, BioMutationId::GillsOfGigahrush)) resist -= 50;
            for (std::size_t s = 0; s < kImplantSlotCount; ++s) {
                if (implant_is_functioning(r, static_cast<ImplantSlot>(s))) {
                    const auto& idf = implant_def(static_cast<ImplantId>(r.implantId[s]));
                    resist += idf.fireResistPct;
                }
            }
            break;
        case 4: // Psi / Samosbor
            if (has_perk(r, PerkId::SamosborSurvivor)) resist += 50;
            break;
        default:
            break;
    }

    if (resist > 95) resist = 95;
    if (resist < -100) resist = -100;
    return static_cast<std::int16_t>(resist);
}

std::uint16_t rpg_heal_mult_e3(const RpgStats& r) {
    std::uint16_t acc = 1000;
    if (has_trait(r, TraitId::FastMetabolism)) acc = mul_e3(acc, 1300);
    if (has_trait(r, TraitId::ChemResistant))  acc = mul_e3(acc, 500);
    if (has_mutation(r, BioMutationId::AcidicBlood)) acc = mul_e3(acc, 700);
    return acc;
}

std::uint16_t rpg_water_drain_mult_e3(const RpgStats& r) {
    std::uint16_t acc = 1000;
    if (has_trait(r, TraitId::FastMetabolism)) acc = mul_e3(acc, 1250);
    if (has_mutation(r, BioMutationId::GillsOfGigahrush)) acc = mul_e3(acc, 700);
    return acc;
}

// ---------------------------------------------------------------------------
// XP Sources & Progression
// ---------------------------------------------------------------------------
std::uint32_t xp_for_monster_kill(MobKind kind, std::uint8_t monsterLevel) {
    return scale_kill_xp(monster_base_xp(kind), monsterLevel);
}

std::uint32_t xp_for_npc_kill(std::uint8_t npcLevel) {
    return scale_kill_xp(10, npcLevel);
}

std::uint32_t xp_for_quest(std::uint16_t difficultyE1) {
    return static_cast<std::uint32_t>(difficultyE1) * 2u;
}

XpAward award_xp(RpgStats& r, std::uint32_t amount, std::int16_t* hp, std::int16_t* maxHp) {
    XpAward out;
    r.level = clamp_rpg_level(r.level);

    if (r.level >= kRpgLevelCap) {
        r.xp = 0;
        const std::uint16_t cap = max_psi(r);
        if (r.psi > cap) r.psi = cap;
        out.newLevel = r.level;
        out.atCap = true;
        return out;
    }

    const std::uint64_t adjusted =
        (static_cast<std::uint64_t>(amount) *
         static_cast<std::uint64_t>(int_xp_mult_e3(r)) + 500ull) / 1000ull;
    out.newLevel = r.level;
    if (adjusted == 0) return out;

    out.granted = adjusted > 0xFFFFFFFFull ? 0xFFFFFFFFu : static_cast<std::uint32_t>(adjusted);
    const std::uint64_t pooled = static_cast<std::uint64_t>(r.xp) + static_cast<std::uint64_t>(out.granted);
    r.xp = pooled > 0xFFFFFFFFull ? 0xFFFFFFFFu : static_cast<std::uint32_t>(pooled);

    while (r.level < kRpgLevelCap) {
        const std::uint32_t need = xp_for_level(static_cast<std::uint8_t>(r.level + 1));
        if (r.xp < need) break;
        r.xp -= need;
        ++r.level;
        if (r.attrPoints < 255) ++r.attrPoints;
        if (has_perk(r, PerkId::Educated) && (r.level % 3 == 0) && r.attrPoints < 255) {
            ++r.attrPoints; // Educated perk: +1 extra skill point / 3 lvls
        }
        if ((r.level % 2 == 0) && r.perkPoints < 255) ++r.perkPoints; // 1 perk point every 2 levels
        r.psi = max_psi(r);
        credit_max_hp_gain(r, hp, maxHp);
        ++out.levelsGained;
    }

    if (r.level >= kRpgLevelCap) {
        r.xp = 0;
        out.atCap = true;
    }
    out.newLevel = r.level;
    return out;
}

bool spend_attr_point(RpgStats& r, Attr a, std::int16_t* hp, std::int16_t* maxHp) {
    if (a >= Attr::Count) return false;
    if (r.attrPoints == 0) return false;
    const std::size_t slot = static_cast<std::size_t>(a);
    if (r.attr[slot] >= kRpgAttributeCap) return false;

    const std::uint16_t oldPsiMax = max_psi(r);
    --r.attrPoints;
    ++r.attr[slot];

    if (a == Attr::Str || a == Attr::End) credit_max_hp_gain(r, hp, maxHp);
    if (a == Attr::Int) {
        const std::uint16_t newMax = max_psi(r);
        const int gain = static_cast<int>(newMax) - static_cast<int>(oldPsiMax);
        const int raised = static_cast<int>(r.psi) + (gain > 0 ? gain : 0);
        r.psi = static_cast<std::uint16_t>(raised > newMax ? newMax : raised);
    }
    return true;
}

} // namespace giga::game
