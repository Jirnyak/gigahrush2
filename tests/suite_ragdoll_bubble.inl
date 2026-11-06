// ПУЗЫРЬ РАГДОЛЛОВ — первый потребитель системы присутствия класса 1
// (F1, matwej.md §17.2 / §21.F / §23.7). Включается в world_test.cpp: его
// CHECK, его `using namespace giga`.
//
// ЧТО ЗДЕСЬ ЗАПИНЕНО, И ЧЕМ КАЖДОЕ МОЖНО ОПРОВЕРГНУТЬ:
//
//  1. НАБЛЮДАТЕЛЯ НЕТ — ПУЗЫРЯ НЕТ. Без центров ни одно тело не застывает.
//     Это не мелочь: без этого закона каждый headless-пин этого файла стал бы
//     краснеть не от дефекта, а от того, что в тесте некому смотреть.
//
//  2. ЗАСТЫВАНИЕ ВЫНИМАЕТ ИЗ СОЛВЕРА, А НЕ РАЗБИРАЕТ ТЕЛО. Трансформы и
//     кватернионы застывшей цепи БИТ-В-БИТ те же через сколько угодно тиков,
//     сущности-сегменты и линк-сущности целы, решений сустава ноль. Это
//     ctest-форма «скриншота до и после прохода мимо трупа» из §23.6: позу
//     никто не пересобрал, потому что пересобирать нечего.
//
//  3. КОММУТАЦИЯ (§23.1) — ЧЕСТНО, С ЧИСЛОМ, А НЕ ЛОЗУНГОМ. Прогон «радиус ∞»
//     против настоящего радиуса на ОДНОЙ сцене, дайджест состояния мира.
//     Приём — тот же, что у `test_cadence_equivalence` ([medium_test.cpp]:
//     два каденса, один дайджест, строка с пометкой расхождения). И тот же
//     тест печатает НАЙДЕННОЕ РАСХОЖДЕНИЕ В МЕТРАХ: см. длинный разбор у
//     `test_bubble_commutation_bounded` — бит-в-бит здесь недостижимо по
//     построению предиката, и это свойство предмета, а не теста.
//
//  4. ТРИ ДОЛГА КОММУТАЦИИ ЖИВЫ: выкарв опоры, контакт ходячего и запись
//     скорости извне СНИМАЮТ застывание. Каждый — отдельный CHECK, потому что
//     каждый по отдельности есть «труп висит в воздухе» / «NPC прошёл сквозь
//     труп» / «взрыв не долетел».
//
//  5. ВОЗВРАТ МГНОВЕНЕН, ПОВТОРНОЕ ЗАСТЫВАНИЕ — НЕТ. Гистерезис выведен, а не
//     назначен: оживление обнуляет стаж тишины, поэтому цена дрожания границы
//     ограничена сверху ровно kSuspendQuietTicks тиками решения.

#include "sim/presence.h"
#include "sim/rigid.h"

namespace ragdoll_bubble_test {

// Сцена: пол из клеток и ОДНА цепь из kSeg тел — та же форма, которой
// рождается труп (сегменты + линк-сущности), собранная здесь руками. Корень
// сцены ставится по заказу, чтобы тест мог положить цепь ВНУТРЬ пузыря или
// НАРУЖУ, не трогая радиус.
struct ChainScene {
    static constexpr int kSeg = 4; // гуманоид: голова-грудь-таз-ноги (§17.2)
    LevelStack stack;
    Registry reg;
    LayerId layer = 0;
    float floorTop = 0.0f;
    Entity seg[kSeg]{};
    Entity link[kSeg - 1]{};
};

inline void build_chain_scene(ChainScene& s, float cx, float cy) {
    s.layer = s.stack.push_layer();
    World& w = s.stack.layer(s.layer);
    // Пол шире цепи во все стороны: тело, уехавшее за край, падало бы вечно и
    // пин «уснуло на полу» ловил бы геометрию сцены, а не закон.
    const int gx = static_cast<int>(cx / kCellSize);
    const int gy = static_cast<int>(cy / kCellSize);
    for (int y = gy - 6; y <= gy + 6; ++y)
        for (int x = gx - 6; x <= gx + 6; ++x)
            w.grid().fill_cell(wrap_macro(x), wrap_macro(y), 4, 1);
    s.floorTop = 5.0f * kCellSize;

    const float radius = 0.15f;
    const float mass = 7800.0f * (4.0f / 3.0f) * 3.14159265f * radius *
                       radius * radius;
    Entity prev = entt::null;
    for (int i = 0; i < ChainScene::kSeg; ++i) {
        RigidBody rb;
        rb.radius = radius;
        rb.invMass = 1.0f / mass;
        rb.invInertia = 1.0f / (0.4f * mass * radius * radius);
        rb.restitution = 0.35f;
        rb.friction = 0.6f;
        const Entity e = s.reg.create();
        s.reg.emplace<Transform>(
            e, Transform{vec3{cx + 0.5f * static_cast<float>(i) * kCellSize,
                              cy + 0.03f * static_cast<float>(i),
                              s.floorTop + 0.6f},
                         s.layer});
        s.reg.emplace<Velocity>(e);
        s.reg.emplace<RigidBody>(e, rb);
        s.seg[i] = e;
        if (i > 0) {
            const Entity le = s.reg.create();
            JointLink jl;
            jl.a = e;
            jl.b = prev;
            jl.restLen = 3.0f * radius;
            jl.rope = true;
            s.reg.emplace<JointLink>(le, jl);
            s.link[i - 1] = le;
        }
        prev = e;
    }
}

// ДАЙДЖЕСТ СОСТОЯНИЯ МИРА — форма взята у `cadence_digest` ([medium_test.cpp]):
// FNV-1a по байтам, складываются id сущности и КВАНТОВАННЫЕ поза с ориентацией.
// Квант назван и выведен ниже, у самого теста коммутации.
inline std::uint64_t bubble_digest(const Registry& reg, float posQuantum,
                                   float* maxPosOut, const Registry* ref) {
    std::uint64_t h = 1469598103934665603ull;
    auto fold = [&h](std::uint64_t v) {
        for (int i = 0; i < 8; ++i) {
            h ^= (v >> (i * 8)) & 0xFFull;
            h *= 1099511628211ull;
        }
    };
    auto q = [posQuantum](float v) {
        return static_cast<std::int64_t>(std::floor(v / posQuantum + 0.5f));
    };
    auto view = reg.view<const Transform, const RigidBody>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        const RigidBody& rb = view.get<const RigidBody>(e);
        fold(static_cast<std::uint64_t>(static_cast<std::uint32_t>(e)));
        fold(static_cast<std::uint64_t>(q(tr.pos.x)));
        fold(static_cast<std::uint64_t>(q(tr.pos.y)));
        fold(static_cast<std::uint64_t>(q(tr.pos.z)));
        // Кватернион квантуется ТЕМ ЖЕ числом в своих единицах: компоненты
        // лежат в [-1,1], поэтому шаг 0.001 даёт ~0.06° — на два порядка
        // мельче, чем видно глазом, и грубее, чем последний бит float.
        fold(static_cast<std::uint64_t>(
            static_cast<std::int64_t>(std::floor(rb.q.x * 1000.0f + 0.5f))));
        fold(static_cast<std::uint64_t>(
            static_cast<std::int64_t>(std::floor(rb.q.y * 1000.0f + 0.5f))));
        fold(static_cast<std::uint64_t>(
            static_cast<std::int64_t>(std::floor(rb.q.z * 1000.0f + 0.5f))));
        fold(static_cast<std::uint64_t>(
            static_cast<std::int64_t>(std::floor(rb.q.w * 1000.0f + 0.5f))));
        if (maxPosOut && ref && ref->valid(e) && ref->all_of<Transform>(e)) {
            const vec3 d = wrap_delta3(ref->get<const Transform>(e).pos,
                                       tr.pos, kWorldExtent);
            const float dist = length(d);
            if (dist > *maxPosOut) *maxPosOut = dist;
        }
    }
    return h;
}

// ---- 1. НАБЛЮДАТЕЛЯ НЕТ — ПУЗЫРЯ НЕТ --------------------------------------
static void test_no_observer_no_bubble() {
    presence_reset(); // центров ноль
    ChainScene s;
    build_chain_scene(s, 20.0f * kCellSize, 20.0f * kCellSize);
    // 8 секунд: падение ~0.35 с, оседание, порог сна 0.26 с с контактом, порог
    // застывания — те же 32 тика тишины. Времени хватает обоим с запасом.
    for (int i = 0; i < 8 * kSimHz; ++i)
        rigid_body_step(s.reg, s.stack, kSimDt);
    CHECK(presence_center_count() == 0);
    for (int i = 0; i < ChainScene::kSeg; ++i) {
        const RigidBody& rb = s.reg.get<RigidBody>(s.seg[i]);
        CHECK(!rb.suspended); // НИЧЕГО не застыло — смотреть некому
        CHECK(rb.asleep);     // штатный сон при этом работает как до F1
    }
    const RigidStats* rs = s.reg.ctx().find<RigidStats>();
    CHECK(rs != nullptr);
    if (rs) {
        CHECK(rs->suspended == 0);
        CHECK(rs->chains == 0); // решатель даже не строил бины корней
    }
}

// ---- 2. ВЫНУТ ИЗ СОЛВЕРА, А НЕ РАЗОБРАН ------------------------------------
// Это и есть ctest-форма скриншотного гейта §23.6 — и она СИЛЬНЕЕ скриншота,
// потому что сравнивает не пиксели, а те самые числа, из которых пиксели
// берутся, и сравнивает их БИТ-В-БИТ, а не с допуском.
static void test_suspend_freezes_pose_bit_exact() {
    presence_reset();
    ChainScene s;
    // Цепь в 100 м от наблюдателя: это БОЛЬШЕ полного радиуса 64 м, поэтому
    // наружу её выносит УРОВЕНЬ, а не ранг — пин не зависит от N.
    build_chain_scene(s, 20.0f * kCellSize, 20.0f * kCellSize);
    const vec3 centre{20.0f * kCellSize + 100.0f, 20.0f * kCellSize,
                      s.floorTop + 1.6f};
    presence_set_centers(&centre, 1);
    CHECK(presence_center_count() == 1);
    CHECK(wrap_dist(centre, s.reg.get<Transform>(s.seg[0]).pos,
                    kWorldExtent) > kPresenceFullRadius);

    // Оседание + стаж тишины. 8 с с запасом: 32 тика = 0.26 с.
    for (int i = 0; i < 8 * kSimHz; ++i)
        rigid_body_step(s.reg, s.stack, kSimDt);

    std::uint32_t nSusp = 0;
    for (int i = 0; i < ChainScene::kSeg; ++i)
        if (s.reg.get<RigidBody>(s.seg[i]).suspended) ++nSusp;
    CHECK(nSusp == ChainScene::kSeg); // ВСЯ цепь, посегментно и разом

    // Снимок позы — побитовый, через целые: сравнивать float на равенство
    // законно именно здесь, потому что утверждение в том, что их НИКТО НЕ
    // ТРОГАЛ, а не в том, что они «примерно те же».
    vec3 pos0[ChainScene::kSeg];
    quat rot0[ChainScene::kSeg];
    for (int i = 0; i < ChainScene::kSeg; ++i) {
        pos0[i] = s.reg.get<Transform>(s.seg[i]).pos;
        rot0[i] = s.reg.get<RigidBody>(s.seg[i]).q;
    }

    const RigidStats* before = s.reg.ctx().find<RigidStats>();
    const std::uint32_t linksSolvedBefore =
        before ? before->linksSolved : 0xFFFFFFFFu;

    // Ещё 10 секунд мира без наблюдателя рядом.
    for (int i = 0; i < 10 * kSimHz; ++i)
        rigid_body_step(s.reg, s.stack, kSimDt);

    for (int i = 0; i < ChainScene::kSeg; ++i) {
        const Transform& tr = s.reg.get<Transform>(s.seg[i]);
        const RigidBody& rb = s.reg.get<RigidBody>(s.seg[i]);
        CHECK(rb.suspended);
        CHECK(tr.pos.x == pos0[i].x);
        CHECK(tr.pos.y == pos0[i].y);
        CHECK(tr.pos.z == pos0[i].z);
        CHECK(rb.q.x == rot0[i].x);
        CHECK(rb.q.y == rot0[i].y);
        CHECK(rb.q.z == rot0[i].z);
        CHECK(rb.q.w == rot0[i].w);
        // СЕГМЕНТЫ НЕ РАЗРУШЕНЫ — ни тела, ни связи: «вынуть из солвера»
        // буквально означает это, и §17.2 требует именно этого (иначе труп
        // лёг бы на возврате игрока в ДРУГУЮ позу, потому что позы не хранит
        // никто).
        CHECK(s.reg.valid(s.seg[i]));
        CHECK((s.reg.all_of<RigidBody, Transform, Velocity>(s.seg[i])));
    }
    for (int i = 0; i < ChainScene::kSeg - 1; ++i) {
        CHECK(s.reg.valid(s.link[i]));
        CHECK(s.reg.all_of<JointLink>(s.link[i]));
    }
    // И РЕШАТЕЛЬ ИХ НЕ ВИДИТ — производный оракул §64: при полностью
    // застывшей сцене решений сустава НОЛЬ, сколько бы связей в ней ни было.
    const RigidStats* after = s.reg.ctx().find<RigidStats>();
    CHECK(after != nullptr);
    if (after) {
        CHECK(after->linksSolved == 0);
        CHECK(after->suspended == ChainScene::kSeg);
        CHECK(after->chainsInBubble == 0);
        CHECK(after->chains == 1); // одна цепь из четырёх тел
    }
    CHECK(linksSolvedBefore != 0xFFFFFFFFu); // прибор вообще писался
}

// ---- 3. КОММУТАЦИЯ: ЧИСЛОМ, А НЕ ЛОЗУНГОМ ---------------------------------
// ЗДЕСЬ ЖИВЁТ ГЛАВНАЯ ОГОВОРКА F1, И ОНА ДОЛЖНА БЫТЬ ПРОЧИТАНА ВСЛУХ.
//
// §23.2 записал трупы в класс 1 с формулировкой «коммутирует бит-в-бит». На
// ОСЕВШЕЙ цепи это так и есть и проверено выше. Но популяция, ради которой
// пузырь и строился, другая: на 1000 трупах спят 9%, а 91% — тихие тела, чья
// опора сама спит, поэтому контакта им не выдаёт никто и штатный сон до них не
// доходит (§64, rigid.h:41). Для НИХ застывание бит-в-бит НЕ коммутирует, и вот
// точная причина: прогон «радиус ∞» продолжает их интегрировать, а скорость у
// них по предикату застывания может быть любой ДО kSleepV.
//
// ЗНАЧИТ РАСХОЖДЕНИЕ ЕСТЬ, И ЕГО НАДО НЕ СКРЫВАТЬ, А ОГРАНИЧИТЬ И НАЗВАТЬ
// ЧИСЛОМ — ровно то, что §23.2 требует от класса 2. Граница выводится:
// застывшее тело тихое по построению предиката (|v| < kSleepV = 0.05 м/с), а
// значит за тик оно разъезжается со своим ∞-двойником не более чем на
// kSleepV × kSimDt = 0.05 / 125 = 0.4 мм. За окно сравнения W тиков это
// kSleepV × kSimDt × W. Квант дайджеста берётся ровно от этой границы.
//
// ПОЧЕМУ ЭТО ВСЁ РАВНО СИЛЬНЫЙ ГЕЙТ: 0.4 мм за тик — это порог, НИЖЕ которого
// движок сам считает тело неподвижным (вывод kSleepV в rigid.cpp:123: «0.4 мм
// за тик — на глаз неподвижно, 1/600 субвокселя»). То есть застывание вносит
// ошибку меньше собственного разрешения движка по движению. Чем это
// опровергается: замером, на котором максимальное расхождение ВЫШЕ границы —
// тогда предикат застывания пропускает нетихое тело, и это дефект.
static void test_bubble_commutation_bounded() {
    constexpr int kSettleTicks = 8 * kSimHz;   // оседание + стаж тишины
    constexpr int kWindowTicks = 4 * kSimHz;   // окно сравнения, 500 тиков
    // ГРАНИЦА РАСХОЖДЕНИЯ ВЫВЕДЕНА: kSleepV × kSimDt × kWindowTicks =
    // 0.05 м/с × 0.008 с × 500 = 0.2 м.
    const float kBound = 0.05f * (1.0f / static_cast<float>(kSimHz)) *
                         static_cast<float>(kWindowTicks);
    // ДАЙДЖЕСТ ПЕЧАТАЕТСЯ, НО НЕ ТРЕБУЕТСЯ РАВНЫМ — И ЭТО РАЗБОР ПРИБОРА, А НЕ
    // ослабление гейта. Квантование НЕ превращает «расхождение ограничено» в
    // «значения равны»: два числа в 15 мм друг от друга попадают в разные
    // кванты всякий раз, когда ложатся по разные стороны границы кванта, то
    // есть с вероятностью ~(расхождение/квант) НА КАЖДУЮ КООРДИНАТУ. На
    // четырёх телах это монетка, а пин-монетка хуже отсутствия пина: он
    // краснеет без дефекта и его начинают «подкручивать до зелёного». Поэтому
    // ГЕЙТ — ГРАНИЦА (ниже), а дайджест — отпечаток для чтения лога: он
    // отвечает на вопрос «та же это сцена или вообще другая», и в этом виде
    // честен. Бит-в-бит здесь живёт в ДРУГОМ пине —
    // test_suspend_freezes_pose_bit_exact, где равенство точное по построению.
    constexpr float kDigestQuantum = 0.25f;

    ChainScene inf, real_;
    std::uint64_t dig[2] = {0, 0};
    float maxDelta = 0.0f;

    // Прогон А — РАДИУС ∞: пузыря нет, всё живое. Центр ставится ТОТ ЖЕ, что
    // в прогоне Б: разница между прогонами обязана быть РОВНО в радиусе, иначе
    // сличались бы две разные сцены (четвёртый класс лжи прибора — честный и
    // полный ответ на НЕ ЗАДАННЫЙ вопрос).
    const vec3 centre{20.0f * kCellSize + 100.0f, 20.0f * kCellSize,
                      5.0f * kCellSize + 1.6f};
    {
        presence_reset();
        presence_set_centers(&centre, 1);
        presence_force_infinite(true);
        build_chain_scene(inf, 20.0f * kCellSize, 20.0f * kCellSize);
        for (int i = 0; i < kSettleTicks + kWindowTicks; ++i)
            rigid_body_step(inf.reg, inf.stack, kSimDt);
        // Пузыря не было: НИ ОДНО тело не застыло — иначе прогон «всё живое»
        // не был бы прогоном всё живого, и гейт сошёлся бы по неверной
        // причине. Это ровно тот шов, который F0 оставил под этот тест.
        for (int i = 0; i < ChainScene::kSeg; ++i)
            CHECK(!inf.reg.get<RigidBody>(inf.seg[i]).suspended);
        presence_force_infinite(false);
        dig[0] = bubble_digest(inf.reg, kDigestQuantum, nullptr, nullptr);
    }

    // Прогон Б — НАСТОЯЩИЙ радиус: цепь в 100 м, то есть за пределами 64 м.
    {
        presence_reset();
        presence_set_centers(&centre, 1);
        build_chain_scene(real_, 20.0f * kCellSize, 20.0f * kCellSize);
        for (int i = 0; i < kSettleTicks; ++i)
            rigid_body_step(real_.reg, real_.stack, kSimDt);
        std::uint32_t nSusp = 0;
        for (int i = 0; i < ChainScene::kSeg; ++i)
            if (real_.reg.get<RigidBody>(real_.seg[i]).suspended) ++nSusp;
        CHECK(nSusp == ChainScene::kSeg); // тест ДОШЁЛ туда, куда думал
        for (int i = 0; i < kWindowTicks; ++i)
            rigid_body_step(real_.reg, real_.stack, kSimDt);
        dig[1] = bubble_digest(real_.reg, kDigestQuantum, &maxDelta, &inf.reg);
    }

    // Строка прибора — по образцу `test_cadence_equivalence`: она печатает
    // ЧИСЛО, а не вердикт, и помечает расхождение словами, чтобы прогон был
    // читаем без отладчика.
    std::printf("[bubble] коммутация: ∞ %016llx vs R=%.0f м %016llx (квант "
                "%.2f м) | макс расхождение %.6f м при границе %.6f м "
                "(kSleepV × dt × %d тиков)%s\n",
                static_cast<unsigned long long>(dig[0]),
                static_cast<double>(kPresenceFullRadius),
                static_cast<unsigned long long>(dig[1]),
                static_cast<double>(kDigestQuantum),
                static_cast<double>(maxDelta), static_cast<double>(kBound),
                static_cast<int>(kWindowTicks),
                dig[0] == dig[1] ? "" : "  [дайджесты разошлись — смотри "
                                        "расхождение в метрах, не в хеше]");

    // ГЕЙТ: расхождение В ВЫВЕДЕННОЙ ГРАНИЦЕ. Опровергается замером выше
    // границы — тогда предикат застывания пропустил НЕТИХОЕ тело, и это
    // дефект класса «пузырь сломал мир», а не «пузырь сэкономил мало».
    CHECK(maxDelta <= kBound);
    // И ОБА ПРОГОНА ДОШЛИ ТУДА, КУДА ДУМАЛИ: в «∞» тела заснули штатным сном
    // (пузыря не было вовсе), в настоящем — застыли пузырём. Без этой пары
    // гейт границы был бы зелен и на сцене, где не произошло НИЧЕГО.
    for (int i = 0; i < ChainScene::kSeg; ++i) {
        CHECK(inf.reg.get<RigidBody>(inf.seg[i]).asleep);
        CHECK(!inf.reg.get<RigidBody>(inf.seg[i]).suspended);
        CHECK(real_.reg.get<RigidBody>(real_.seg[i]).suspended);
    }
}

// ---- 4. ТРИ ДОЛГА КОММУТАЦИИ ----------------------------------------------
// Каждый проверяется ПО ОТДЕЛЬНОСТИ, потому что каждый по отдельности есть
// видимый баг, а не «недооптимизация».
static void test_suspended_owes_the_world() {
    // (а) ВЫКАРВ ОПОРЫ. Долг писателя геометрии (S20.4) не различает, почему
    //     тело вне решателя. Без этого — «труп висит в воздухе».
    {
        presence_reset();
        ChainScene s;
        build_chain_scene(s, 20.0f * kCellSize, 20.0f * kCellSize);
        const vec3 centre{20.0f * kCellSize + 100.0f, 20.0f * kCellSize,
                          s.floorTop + 1.6f};
        presence_set_centers(&centre, 1);
        for (int i = 0; i < 8 * kSimHz; ++i)
            rigid_body_step(s.reg, s.stack, kSimDt);
        CHECK(s.reg.get<RigidBody>(s.seg[0]).suspended);
        const Transform& tr = s.reg.get<Transform>(s.seg[0]);
        const std::uint32_t cell = static_cast<std::uint32_t>(macro_index(
            wrap_macro(cell_coord(tr.pos.x)), wrap_macro(cell_coord(tr.pos.y)),
            wrap_macro(cell_coord(tr.pos.z))));
        const std::uint32_t woken =
            rigid_wake_dirty_cells(s.reg, s.layer, &cell, 1);
        CHECK(woken >= 1);
        CHECK(!s.reg.get<RigidBody>(s.seg[0]).suspended);
        CHECK(!s.reg.get<RigidBody>(s.seg[0]).asleep);
        CHECK(s.reg.get<RigidBody>(s.seg[0]).quietTicks == 0);
    }

    // (б) КОНТАКТ ХОДЯЧЕГО. NPC ходят по ВСЕМУ этажу независимо от того, где
    //     игрок (изотропия, CANON S16). Без этого — «жилец прошёл сквозь
    //     труп в сорока метрах за спиной игрока».
    {
        presence_reset();
        ChainScene s;
        build_chain_scene(s, 20.0f * kCellSize, 20.0f * kCellSize);
        const vec3 centre{20.0f * kCellSize + 100.0f, 20.0f * kCellSize,
                          s.floorTop + 1.6f};
        presence_set_centers(&centre, 1);
        for (int i = 0; i < 8 * kSimHz; ++i)
            rigid_body_step(s.reg, s.stack, kSimDt);
        CHECK(s.reg.get<RigidBody>(s.seg[0]).suspended);
        const vec3 corpse = s.reg.get<Transform>(s.seg[0]).pos;
        // Агент в словаре солвера: Transform + Velocity + AABB +
        // GravityAffected БЕЗ RigidBody/SelfIntegrating — ровно тот вид, по
        // которому rigid_body_step собирает агентов.
        //
        // ГЕОМЕТРИЯ СЧИТАЕТСЯ, А НЕ УГАДЫВАЕТСЯ, иначе тест был бы зелён
        // «потому что промахнулся». `agent_form` ([sim/rigid.cpp]) кладёт агенту
        // ДВЕ сферы вдоль длинной полуоси: при half {0.4, 0.4, 0.9} радиус =
        // min(half) = 0.4, вылет = 0.9 − 0.4 = 0.5, то есть сферы в центре ±0.5
        // по z. Сегмент — одна сфера 0.15 (ContactForm не вешаем, как и труп в
        // игре для шаровых сегментов). Сумма радиусов 0.55; значит центр агента
        // ставим на 0.5 ВЫШЕ сегмента, чтобы его НИЖНЯЯ сфера пришлась точно на
        // высоту сегмента, и на 0.4 в сторону по x: расстояние сфер 0.4 < 0.55,
        // перекрытие есть. Брод-фаза тоже проходит: 0.15 + 0.9 = 1.05 против
        // sqrt(0.4² + 0.5²) = 0.64.
        //
        // Скорость 1.5 м/с НАПРАВЛЕНА НА труп и нужна дважды: собрать агента в
        // набор (при нулевом awakeCount берутся только движущиеся — закон
        // «стоящий агент спящему пропу ничего не сделает») и дать сближение.
        const Entity ag = s.reg.create();
        s.reg.emplace<Transform>(
            ag, Transform{vec3{corpse.x - 0.4f, corpse.y, corpse.z + 0.5f},
                          s.layer});
        s.reg.emplace<Velocity>(ag, Velocity{vec3{1.5f, 0.0f, 0.0f}});
        s.reg.emplace<AABB>(ag, AABB{vec3{0.4f, 0.4f, 0.9f}});
        s.reg.emplace<GravityAffected>(ag);
        bool unsuspended = false;
        for (int i = 0; i < 16 && !unsuspended; ++i) {
            rigid_body_step(s.reg, s.stack, kSimDt);
            for (int k = 0; k < ChainScene::kSeg; ++k)
                if (!s.reg.get<RigidBody>(s.seg[k]).suspended)
                    unsuspended = true;
        }
        CHECK(unsuspended); // ходячий ДОСТАЛ застывшее тело
        // И ЦЕПЬ ОЖИВАЕТ ЦЕЛИКОМ — через сустав, тем же механизмом, которым
        // распространяется пробуждение из сна: иначе труп растягивался бы.
        // Окно короткое СОЗНАТЕЛЬНО: через kSuspendQuietTicks = 32 тика тишины
        // цепь законно застынет снова, и длинное окно поймало бы это как
        // «не ожила». Распространение по связи идёт за подшаг, так что восьми
        // тиков хватает с запасом в четыре раза.
        for (int i = 0; i < 8; ++i)
            rigid_body_step(s.reg, s.stack, kSimDt);
        std::uint32_t stillSusp = 0;
        for (int k = 0; k < ChainScene::kSeg; ++k)
            if (s.reg.get<RigidBody>(s.seg[k]).suspended) ++stillSusp;
        CHECK(stillSusp == 0);
        const RigidStats* rs = s.reg.ctx().find<RigidStats>();
        CHECK(rs != nullptr);
        if (rs) CHECK(rs->agents >= 1); // агент вообще попал в набор
    }

    // (в) ЗАПИСЬ СКОРОСТИ ИЗВНЕ. Взрыв в другом конце этажа — событие МИРА.
    {
        presence_reset();
        ChainScene s;
        build_chain_scene(s, 20.0f * kCellSize, 20.0f * kCellSize);
        const vec3 centre{20.0f * kCellSize + 100.0f, 20.0f * kCellSize,
                          s.floorTop + 1.6f};
        presence_set_centers(&centre, 1);
        for (int i = 0; i < 8 * kSimHz; ++i)
            rigid_body_step(s.reg, s.stack, kSimDt);
        CHECK(s.reg.get<RigidBody>(s.seg[2]).suspended);
        // Порог — kWakeV = 2 × kSleepV = 0.1 м/с; берём заметно выше, как
        // взрыв, а не как шум записи.
        s.reg.get<Velocity>(s.seg[2]).v = vec3{3.0f, 0.0f, 1.0f};
        rigid_body_step(s.reg, s.stack, kSimDt);
        CHECK(!s.reg.get<RigidBody>(s.seg[2]).suspended);
        const RigidStats* rs = s.reg.ctx().find<RigidStats>();
        CHECK(rs != nullptr);
        if (rs) CHECK(rs->unsuspExtern >= 1);
    }
}

// ---- 5. ВОЗВРАТ МГНОВЕНЕН, ЗАСТЫВАНИЕ — ЧЕРЕЗ СТАЖ ------------------------
// Асимметрия выведена из закона: задержка ОЖИВЛЕНИЯ есть расхождение ровно на
// длину задержки (§23.1), поэтому её нет; а задержка ЗАСТЫВАНИЯ — это стаж
// тишины, который и служит гистерезисом, не будучи отдельным числом.
static void test_revive_is_instant_suspend_is_not() {
    presence_reset();
    ChainScene s;
    build_chain_scene(s, 20.0f * kCellSize, 20.0f * kCellSize);
    const vec3 far_{20.0f * kCellSize + 100.0f, 20.0f * kCellSize,
                    s.floorTop + 1.6f};
    const vec3 near_{20.0f * kCellSize + 2.0f, 20.0f * kCellSize,
                     s.floorTop + 1.6f};
    presence_set_centers(&far_, 1);
    for (int i = 0; i < 8 * kSimHz; ++i)
        rigid_body_step(s.reg, s.stack, kSimDt);
    CHECK(s.reg.get<RigidBody>(s.seg[0]).suspended);
    CHECK(s.reg.get<RigidBody>(s.seg[0]).quietTicks >= 32);

    // Наблюдатель подошёл — ОДИН тик, и вся цепь в решателе.
    presence_set_centers(&near_, 1);
    rigid_body_step(s.reg, s.stack, kSimDt);
    for (int i = 0; i < ChainScene::kSeg; ++i) {
        CHECK(!s.reg.get<RigidBody>(s.seg[i]).suspended);
        // СТАЖ СБРОШЕН НИЖЕ ПОРОГА — это и есть гистерезис: повторное
        // застывание потребует снова 32 тика тишины, поэтому цена одного
        // перехода границы ОГРАНИЧЕНА сверху и не зависит от того, как быстро
        // игрок дёргается.
        //
        // ПРОВЕРЯЕТСЯ «НИЖЕ ПОРОГА», А НЕ «РОВНО НОЛЬ», И ЭТО ПРАВКА ПО
        // РАЗБОРУ, А НЕ ПОСЛАБЛЕНИЕ. Ноль был утверждением не о законе, а о
        // том, В КАКОМ МЕСТЕ ТИКА стоит инкремент стажа: решатель обнуляет его
        // в начале тика, а свип сна начисляет спящему телу в конце того же
        // тика, так что к моменту возврата из `rigid_body_step` стаж законно
        // равен единице. Требовать ноль значило бы пинить порядок фаз под
        // видом пина гистерезиса — и этот пин покраснел бы от ЛЮБОГО
        // правильного переноса инкремента. Закон же здесь один: «меньше
        // порога», то есть «застыть сейчас нельзя», и ровно он проверяется —
        // плюс его следствие двумя абзацами ниже, уже поведением.
        CHECK(s.reg.get<RigidBody>(s.seg[i]).quietTicks < 32);
    }
    const RigidStats* rs = s.reg.ctx().find<RigidStats>();
    CHECK(rs != nullptr);
    if (rs) {
        CHECK(rs->unsuspBubble >= static_cast<std::uint32_t>(ChainScene::kSeg));
        CHECK(rs->chainsInBubble == 1);
        CHECK(rs->suspended == 0);
    }

    // Наблюдатель ушёл — и цепь НЕ застывает на том же тике: стаж надо набрать
    // заново. Проверяется в обе стороны: сразу после ухода ещё жива, через
    // 32+ тика тишины — снова застыла.
    presence_set_centers(&far_, 1);
    rigid_body_step(s.reg, s.stack, kSimDt);
    CHECK(!s.reg.get<RigidBody>(s.seg[0]).suspended);
    for (int i = 0; i < 2 * kSimHz; ++i)
        rigid_body_step(s.reg, s.stack, kSimDt);
    CHECK(s.reg.get<RigidBody>(s.seg[0]).suspended);
    presence_reset();
}

} // namespace ragdoll_bubble_test

static void test_ragdoll_bubble_all() {
    ragdoll_bubble_test::test_no_observer_no_bubble();
    ragdoll_bubble_test::test_suspend_freezes_pose_bit_exact();
    ragdoll_bubble_test::test_bubble_commutation_bounded();
    ragdoll_bubble_test::test_suspended_owes_the_world();
    ragdoll_bubble_test::test_revive_is_instant_suspend_is_not();
    std::printf("[ragdoll-bubble] нет наблюдателя — нет пузыря, поза бит-в-бит, "
                "коммутация в границе, долги карва/агента/взрыва, возврат "
                "мгновенный\n");
}
