#include "game/floors/padic/padic_theme.h"

#include "core/table_guard.h"
#include "world/materials.h"

namespace giga::game {

namespace {

// ---- КАТАЛОГИ МЕБЕЛИ ДЛЯ РАССТАНОВЩИКА -----------------------------------
constexpr PropId kResidentialFurniture[] = {
    PropId::BedCot,
    PropId::ToiletPan,
    PropId::KitchenStove,
    PropId::Sink,
    PropId::KitchenTable,
    PropId::Sofa,
};

constexpr PropId kCommercialFurniture[] = {
    PropId::LabBench,
    PropId::Workbench,
    PropId::ToiletPan,
    PropId::Sink,
    PropId::KitchenTable,
    PropId::SupplyCrate,
};

constexpr PropId kIndustrialFurniture[] = {
    PropId::Lathe,
    PropId::Workbench,
    PropId::SupplyCrate,
    PropId::FuelBarrel,
    PropId::ElectricalShield,
    PropId::FloodLamp,
};

constexpr PropId kDerelictFurniture[] = {
    PropId::SupplyCrate,
    PropId::FuelBarrel,
};

constexpr PropId kPadicDefaultFurniture[] = {
    PropId::SupplyCrate,
    PropId::Terminal,
    PropId::BareBulb,
};

// ---- ОБЪЯВЛЕННЫЕ ГЛАГОЛЫ ДЛЯ ТЕМ (S12.1 / S24) ----------------------------
constexpr PadicAffordances make_residential_affordances() {
    PadicAffordances a{};
    a.d[0][kVerbSleep] = 30;
    a.d[1][kVerbToilet] = 20;
    a.d[1][kVerbDrink] = 10;
    a.d[2][kVerbEat] = 12;
    a.d[2][kVerbDrink] = 14;
    a.d[3][kVerbStore] = 15;
    return a;
}

constexpr PadicAffordances make_commercial_affordances() {
    PadicAffordances a{};
    a.d[0][kVerbTrade] = 35;
    a.d[0][kVerbWork] = 20;
    a.d[0][kVerbStore] = 15;
    a.d[1][kVerbToilet] = 25;
    a.d[1][kVerbDrink] = 10;
    a.d[2][kVerbEat] = 25;
    a.d[2][kVerbDrink] = 25;
    a.d[2][kVerbSocial] = 20;
    a.d[3][kVerbStore] = 35;
    a.d[3][kVerbHaul] = 25;
    return a;
}

constexpr PadicAffordances make_industrial_affordances() {
    PadicAffordances a{};
    a.d[0][kVerbWork] = 40;
    a.d[0][kVerbCraft] = 35;
    a.d[1][kVerbToilet] = 20;
    a.d[1][kVerbDrink] = 15;
    a.d[2][kVerbCraft] = 30;
    a.d[2][kVerbWork] = 25;
    a.d[3][kVerbStore] = 40;
    a.d[3][kVerbHaul] = 35;
    return a;
}

constexpr PadicAffordances make_derelict_affordances() {
    PadicAffordances a{};
    a.d[0][kVerbNest] = 35;
    a.d[0][kVerbHunt] = 30;
    a.d[1][kVerbDrink] = 5;
    a.d[2][kVerbProfit] = 25;
    a.d[2][kVerbHunt] = 15;
    a.d[3][kVerbStore] = 15;
    a.d[3][kVerbNest] = 15;
    return a;
}

constexpr PadicAffordances make_padic_affordances() {
    PadicAffordances a{};
    a.d[0][kVerbSleep] = 30;
    a.d[0][kVerbProfit] = 20;
    a.d[1][kVerbToilet] = 20;
    a.d[1][kVerbDrink] = 10;
    a.d[2][kVerbEat] = 12;
    a.d[2][kVerbDrink] = 14;
    a.d[3][kVerbStore] = 15;
    return a;
}

// Таблица тем, строго в порядке FloorKind enum
constexpr PadicTheme kThemes[] = {
    // 0: Residential — классический жилой падик
    {
        FloorKind::Residential,
        "Residential",
        /*storeyHeight=*/3,
        /*lastBase=*/123,
        /*corridorWidth=*/2,
        /*aptMinSpan=*/9,
        /*roomMinSpan=*/5,
        /*matFloorMain=*/kMatParquet,
        /*matFloorAlt=*/kMatLino,
        /*matWall=*/kMatPlaster,
        /*matCeiling=*/kMatPlaster,
        /*matStair=*/kMatConcrete,
        /*matGrate=*/kMatTread,
        /*shopfrontProb=*/0.0f,
        /*wideGalleries=*/false,
        /*highCeilings=*/false,
        /*gantryCatwalks=*/false,
        /*pillarSpacing=*/0,
        /*holeProb=*/0.40f,
        /*holeMinRadius=*/5,
        /*holeMaxRadius=*/12,
        /*wallBreachProb=*/0.0f,
        /*stairBuryProb=*/0.125f,
        /*toxicGasInPits=*/false,
        make_residential_affordances(),
        kResidentialFurniture,
        sizeof(kResidentialFurniture) / sizeof(kResidentialFurniture[0]),
    },
    // 1: Commercial — торговые пассажи, витрины, широкие галереи
    {
        FloorKind::Commercial,
        "Commercial",
        /*storeyHeight=*/3,
        /*lastBase=*/123,
        /*corridorWidth=*/4,
        /*aptMinSpan=*/14,
        /*roomMinSpan=*/8,
        /*matFloorMain=*/kMatSlabTan,
        /*matFloorAlt=*/kMatLino,
        /*matWall=*/kMatPlaster,
        /*matCeiling=*/kMatPlaster,
        /*matStair=*/kMatConcrete,
        /*matGrate=*/kMatTread,
        /*shopfrontProb=*/0.65f,
        /*wideGalleries=*/true,
        /*highCeilings=*/false,
        /*gantryCatwalks=*/false,
        /*pillarSpacing=*/0,
        /*holeProb=*/0.25f,
        /*holeMinRadius=*/4,
        /*holeMaxRadius=*/9,
        /*wallBreachProb=*/0.0f,
        /*stairBuryProb=*/0.05f,
        /*toxicGasInPits=*/false,
        make_commercial_affordances(),
        kCommercialFurniture,
        sizeof(kCommercialFurniture) / sizeof(kCommercialFurniture[0]),
    },
    // 2: Industrial — высокие цеха (12 м), балки, станки, металл
    {
        FloorKind::Industrial,
        "Industrial",
        /*storeyHeight=*/6,
        /*lastBase=*/120,
        /*corridorWidth=*/3,
        /*aptMinSpan=*/24,
        /*roomMinSpan=*/16,
        /*matFloorMain=*/kMatConcrete,
        /*matFloorAlt=*/kMatTread,
        /*matWall=*/kMatFactoryWall,
        /*matCeiling=*/kMatFactoryWall,
        /*matStair=*/kMatConcrete,
        /*matGrate=*/kMatTread,
        /*shopfrontProb=*/0.0f,
        /*wideGalleries=*/false,
        /*highCeilings=*/true,
        /*gantryCatwalks=*/true,
        /*pillarSpacing=*/8,
        /*holeProb=*/0.40f,
        /*holeMinRadius=*/6,
        /*holeMaxRadius=*/14,
        /*wallBreachProb=*/0.0f,
        /*stairBuryProb=*/0.15f,
        /*toxicGasInPits=*/false,
        make_industrial_affordances(),
        kIndustrialFurniture,
        sizeof(kIndustrialFurniture) / sizeof(kIndustrialFurniture[0]),
    },
    // 3: Derelict — обрушения, проломы стен, щебень, ржавчина, газ
    {
        FloorKind::Derelict,
        "Derelict",
        /*storeyHeight=*/3,
        /*lastBase=*/123,
        /*corridorWidth=*/2,
        /*aptMinSpan=*/8,
        /*roomMinSpan=*/4,
        /*matFloorMain=*/kMatRubble,
        /*matFloorAlt=*/kMatRust,
        /*matWall=*/kMatRust,
        /*matCeiling=*/kMatRust,
        /*matStair=*/kMatConcrete,
        /*matGrate=*/kMatTread,
        /*shopfrontProb=*/0.0f,
        /*wideGalleries=*/false,
        /*highCeilings=*/false,
        /*gantryCatwalks=*/false,
        /*pillarSpacing=*/0,
        /*holeProb=*/0.85f,
        /*holeMinRadius=*/8,
        /*holeMaxRadius=*/22,
        /*wallBreachProb=*/0.35f,
        /*stairBuryProb=*/0.60f,
        /*toxicGasInPits=*/true,
        make_derelict_affordances(),
        kDerelictFurniture,
        sizeof(kDerelictFurniture) / sizeof(kDerelictFurniture[0]),
    },
    // 4: Padic — 4D-спектр фрактальной общаги
    {
        FloorKind::Padic,
        "Padic",
        /*storeyHeight=*/3,
        /*lastBase=*/123,
        /*corridorWidth=*/2,
        /*aptMinSpan=*/9,
        /*roomMinSpan=*/5,
        /*matFloorMain=*/kMatLino,
        /*matFloorAlt=*/kMatParquet,
        /*matWall=*/kMatPlaster,
        /*matCeiling=*/kMatPlaster,
        /*matStair=*/kMatConcrete,
        /*matGrate=*/kMatTread,
        /*shopfrontProb=*/0.0f,
        /*wideGalleries=*/false,
        /*highCeilings=*/false,
        /*gantryCatwalks=*/false,
        /*pillarSpacing=*/0,
        /*holeProb=*/0.50f,
        /*holeMinRadius=*/5,
        /*holeMaxRadius=*/15,
        /*wallBreachProb=*/0.05f,
        /*stairBuryProb=*/0.20f,
        /*toxicGasInPits=*/false,
        make_padic_affordances(),
        kPadicDefaultFurniture,
        sizeof(kPadicDefaultFurniture) / sizeof(kPadicDefaultFurniture[0]),
    },
    // 5: Blame — фолбэк для мегаструктуры
    {
        FloorKind::Blame,
        "Blame",
        /*storeyHeight=*/3,
        /*lastBase=*/123,
        /*corridorWidth=*/2,
        /*aptMinSpan=*/9,
        /*roomMinSpan=*/5,
        /*matFloorMain=*/kMatConcrete,
        /*matFloorAlt=*/kMatTread,
        /*matWall=*/kMatConcrete,
        /*matCeiling=*/kMatConcrete,
        /*matStair=*/kMatConcrete,
        /*matGrate=*/kMatTread,
        /*shopfrontProb=*/0.0f,
        /*wideGalleries=*/false,
        /*highCeilings=*/false,
        /*gantryCatwalks=*/false,
        /*pillarSpacing=*/0,
        /*holeProb=*/0.40f,
        /*holeMinRadius=*/5,
        /*holeMaxRadius=*/12,
        /*wallBreachProb=*/0.0f,
        /*stairBuryProb=*/0.125f,
        /*toxicGasInPits=*/false,
        make_residential_affordances(),
        kResidentialFurniture,
        sizeof(kResidentialFurniture) / sizeof(kResidentialFurniture[0]),
    },
    // 6: Khrushi — фолбэк для микрорайона
    {
        FloorKind::Khrushi,
        "Khrushi",
        /*storeyHeight=*/3,
        /*lastBase=*/123,
        /*corridorWidth=*/2,
        /*aptMinSpan=*/9,
        /*roomMinSpan=*/5,
        /*matFloorMain=*/kMatParquet,
        /*matFloorAlt=*/kMatLino,
        /*matWall=*/kMatPlaster,
        /*matCeiling=*/kMatPlaster,
        /*matStair=*/kMatConcrete,
        /*matGrate=*/kMatTread,
        /*shopfrontProb=*/0.0f,
        /*wideGalleries=*/false,
        /*highCeilings=*/false,
        /*gantryCatwalks=*/false,
        /*pillarSpacing=*/0,
        /*holeProb=*/0.40f,
        /*holeMinRadius=*/5,
        /*holeMaxRadius=*/12,
        /*wallBreachProb=*/0.0f,
        /*stairBuryProb=*/0.125f,
        /*toxicGasInPits=*/false,
        make_residential_affordances(),
        kResidentialFurniture,
        sizeof(kResidentialFurniture) / sizeof(kResidentialFurniture[0]),
    },
};
GIGA_TABLE_BY_ENUM(kThemes, &PadicTheme::kind, FloorKind::Count);

} // namespace

const PadicTheme& padic_theme_for(FloorKind kind) {
    const std::size_t idx = static_cast<std::size_t>(kind);
    if (idx >= static_cast<std::size_t>(FloorKind::Count)) {
        return kThemes[0];
    }
    return kThemes[idx];
}

} // namespace giga::game
