#include "game/chronicle.h"

#include <cstdio>

#include "core/tick.h"    // kSimHz — мост в секунды ТОЛЬКО для показа
#include "game/faction.h" // faction_name — подлежащее, когда столбца имён нет

namespace giga::game {

// ПЯТЬ РОДОВ, И ОНИ НЕ ВЫДУМАНЫ. Утверждение проверяет САМИ ДАННЫЕ: роды
// памяти обязаны совпасть с теми строками verbs.csv, у которых ненулевая цена.
// Разошлись — значит, кто-то дописал цену глаголу и не заметил, что мир начал
// это помнить (или снял цену и мир забыл). Число названо, потому что подсчёт
// по той же таблице был бы тавтологией.
constexpr int remembered_kind_count() {
    int n = 0;
    for (VerbId v = 0; v < kVerbCount; ++v)
        if (fact_kind_remembered(v)) ++n;
    return n;
}
static_assert(remembered_kind_count() == 5,
              "роды летописи = строки verbs.csv с ненулевой ценой деяния "
              "(toilet, heal, strike, kill, rob). Число поехало — значит "
              "поехал словарь: сверь rel_delta/rep_delta и скажи вслух, что "
              "именно мир начал (или перестал) помнить");

// Окна сегодняшних родов — ИСПОЛНЕНИЕМ, а не пересказом шапки: лестница S15
// меняется одной строкой `kTactShift`, и если она двинется, эти пины покажут,
// что память мира поехала вместе с календарём.
static_assert(fact_window_ticks(kVerbStrike) == 32768);
static_assert(fact_window_ticks(kVerbHeal) == 32768);
static_assert(fact_window_ticks(kVerbToilet) == kWatchTicks);
static_assert(fact_window_ticks(kVerbRob) == kWatchTicks);
static_assert(fact_window_ticks(kVerbKill) == 2 * kWatchTicks);
static_assert(fact_window_ticks(kVerbWander) == 0,
              "глагол без цены мир не помнит — окно ноль, и это ЗНАЧЕНИЕ");

void Chronicle::init() {
    ring_.assign(kCapacity, Fact{});
    head_.assign(kBuckets, kFactNone);
    first_ = 0;
    next_ = 0;
}

bool Chronicle::file(std::uint64_t tick, VerbId kind, NpcId subject,
                     NpcId object, std::int16_t floor, RoomId room) {
    // Мир не помнит рода без цены (закон 1). Отказ, а не молчаливый пропуск.
    if (fact_window_ticks(kind) == 0) return false;
    if (ring_.empty()) init();

    const std::uint32_t seq = next_++;
    // Кольцо полно — старшая граница окна уезжает, и ровно этим мир ЗАБЫВАЕТ.
    if (next_ - first_ > kCapacity) ++first_;
    Fact& f = ring_[seq % kCapacity];
    f.tick = tick;
    f.seq = seq;
    f.subject = subject;
    f.object = object;
    f.floor = floor;
    f.room = room;
    f.kind = kind;
    f.pad_[0] = f.pad_[1] = f.pad_[2] = 0;

    // Интрузивное звено: новый факт встаёт ГОЛОВОЙ цепи своей корзины, а
    // прежняя голова становится его «следующим» (постарше). Если та уже
    // вытеснена кольцом, звено мертво по построению — `at()` вернёт nullptr и
    // обход кончится. Ни расцепления, ни учёта.
    const std::uint32_t b = bucket_of(room);
    f.nextInRoom = head_[b];
    head_[b] = seq;
    return true;
}

void Chronicle::save_facts(std::vector<Fact>& out) const {
    out.clear();
    const std::uint32_t n = live();
    out.reserve(n);
    for (std::uint32_t i = 0; i < n; ++i) out.push_back(*nth(i));
}

bool Chronicle::load_facts(const Fact* facts, std::size_t n, std::uint64_t now) {
    if (n > kCapacity) return false;
    // ПАЧКА ОБЯЗАНА БЫТЬ ОКНОМ КОЛЬЦА, а не просто возрастающей: номера идут
    // подряд, без дыр. Не придирка к формату, а то, чем окно [first_, next_)
    // является: дыра внутри него означала бы «живой» номер, под которым в
    // кольце лежит нетронутый слот, то есть ответ из мусора. Возрастание
    // проверяется этим же равенством (закон 4 — «раньше» обязано быть раньше).
    for (std::size_t i = 1; i < n; ++i)
        if (facts[i].seq != facts[i - 1].seq + 1) return false;

    init();
    if (n == 0) return true;
    // База перебазирования — тик САМОГО СВЕЖЕГО факта (см. шапку `load_facts`).
    const std::uint64_t base = facts[n - 1].tick;
    // seq сохраняются как были — иначе цепи, сейвы и «что раньше» разъехались
    // бы при каждой загрузке. Окно садится ровно на пачку.
    first_ = facts[0].seq;
    next_ = facts[n - 1].seq + 1;

    for (std::size_t i = 0; i < n; ++i) {
        Fact f = facts[i];
        // Возраст относительно самого свежего — он и есть всё, что значимо.
        const std::uint64_t age = base >= f.tick ? base - f.tick : 0;
        f.tick = now >= age ? now - age : 0;
        const std::uint32_t b = bucket_of(f.room);
        // ПЕРЕСБОРКА ЦЕПЕЙ тем же проходом, которым они строились: идём от
        // старого к свежему, каждый становится головой своей корзины.
        f.nextInRoom = head_[b];
        f.pad_[0] = f.pad_[1] = f.pad_[2] = 0;
        ring_[f.seq % kCapacity] = f;
        head_[b] = f.seq;
    }
    return true;
}

// --- три запроса -----------------------------------------------------------
//
// Общая форма у всех трёх: идём от свежего к старому и ОСТАНАВЛИВАЕМСЯ, как
// только факт вышел из своего окна. Ранний выход законен, потому что и цепь, и
// кольцо упорядочены по seq, а tick по seq не убывает: продюсер штампует время
// тем же счётчиком сим-тиков.

namespace {

bool in_window(const Fact& f, std::uint64_t now) {
    const std::uint64_t w = fact_window_ticks(f.kind);
    if (w == 0) return false;
    // Факт из будущего (сейв, загруженный «назад во времени») окном не
    // отсекается: он свежайший из возможных, а не просроченный.
    return f.tick >= now || (now - f.tick) < w;
}

} // namespace

std::uint32_t chronicle_near(const Chronicle& ch, std::int16_t floor, RoomId room,
                             std::uint64_t now, const Fact** newest) {
    if (newest) *newest = nullptr;
    std::uint32_t n = 0;
    for (const Fact* f = ch.bucket_head(room); f != nullptr;
         f = ch.chain_next(*f)) {
        // РАННИЙ ВЫХОД — по САМОМУ ДОЛГОМУ окну, а не по окну этого звена:
        // роды в цепи смешаны, и забытый удар стоит в ней впереди живого
        // убийства. Дальше `kFactWindowMax` не помнит ни один род.
        if (f->tick < now && (now - f->tick) >= kFactWindowMax) break;
        // Корзина — хеш (Chronicle::kBuckets): место сверяется у КАЖДОГО
        // звена, иначе чужая комната или чужой этаж попали бы в ответ.
        if (f->room != room || f->floor != floor) continue;
        if (!in_window(*f, now)) continue;
        if (newest && *newest == nullptr) *newest = f;
        ++n;
    }
    return n;
}

std::uint32_t chronicle_recent(const Chronicle& ch, VerbId kind,
                               std::uint64_t now, const Fact** newest) {
    if (newest) *newest = nullptr;
    const std::uint64_t w = fact_window_ticks(kind);
    if (w == 0) return 0; // мир этого рода не помнит — запрос честно пуст
    std::uint32_t n = 0;
    // Кольцом от свежего к старому: у рода одно окно, поэтому первый
    // выпавший из него факт закрывает обход целиком.
    const std::uint32_t live = ch.live();
    for (std::uint32_t i = live; i-- > 0;) {
        const Fact* f = ch.nth(i);
        if (f == nullptr) break;
        if (f->tick < now && (now - f->tick) >= w) break;
        if (f->kind != kind) continue;
        if (newest && *newest == nullptr) *newest = f;
        ++n;
    }
    return n;
}

std::uint32_t chronicle_near_kind(const Chronicle& ch, std::int16_t floor,
                                  RoomId room, VerbId kind, std::uint64_t now,
                                  const Fact** newest) {
    if (newest) *newest = nullptr;
    const std::uint64_t w = fact_window_ticks(kind);
    if (w == 0) return 0;
    std::uint32_t n = 0;
    for (const Fact* f = ch.bucket_head(room); f != nullptr;
         f = ch.chain_next(*f)) {
        if (f->tick < now && (now - f->tick) >= w) break; // окно рода закрыто
        if (f->kind != kind) continue;
        if (f->room != room || f->floor != floor) continue;
        if (newest && *newest == nullptr) *newest = f;
        ++n;
    }
    return n;
}

// --- вид -------------------------------------------------------------------

namespace {

// Подлежащее одной записи. Столбец имён в пуле — DEMAND и пуст (в `src/`
// `set_name` не зовёт никто), поэтому человека называет его фракция и номер
// записи. Это НЕ заглушка: фракция — то, по чему мир его и различает (S19
// гнёт матрицу по строке фракции, а не по имени).
void write_who(const NpcPool& pool, NpcId id, char* buf, std::size_t cap) {
    if (cap == 0) return;
    if (!pool.valid(id)) {
        std::snprintf(buf, cap, "—");
        return;
    }
    const char* nm = pool.name(id).data();
    if (nm[0] != '\0') {
        std::snprintf(buf, cap, "%s", nm);
        return;
    }
    const std::uint16_t fx = pool.faction(id);
    std::snprintf(buf, cap, "%s #%u",
                  fx < kFactionCount ? faction_name(static_cast<Faction>(fx))
                                     : "?",
                  static_cast<unsigned>(id));
}

} // namespace

std::size_t fact_line(const Fact& f, const NpcPool& pool, std::uint64_t now,
                      char* out, std::size_t cap) {
    if (out == nullptr || cap == 0) return 0;
    char who[48];
    char whom[48];
    write_who(pool, f.subject, who, sizeof(who));
    write_who(pool, f.object, whom, sizeof(whom));
    // Возраст — в секундах, и это МОСТ для показа человеку, а не второе
    // представление времени (тот же статус, что у `kTactSeconds`): внутри
    // летопись живёт в тиках и окнами лестницы S15.
    const double ago = f.tick >= now
                           ? 0.0
                           : static_cast<double>(now - f.tick) /
                                 static_cast<double>(kSimHz);
    const char* verb = f.kind < kVerbCount ? kVerbNames[f.kind] : "?";
    int w = 0;
    if (pool.valid(f.object))
        w = std::snprintf(out, cap, "%s: %s → %s | этаж %d комната %u | %.0f с",
                          verb, who, whom, static_cast<int>(f.floor),
                          static_cast<unsigned>(f.room), ago);
    else
        w = std::snprintf(out, cap, "%s: %s | этаж %d комната %u | %.0f с",
                          verb, who, static_cast<int>(f.floor),
                          static_cast<unsigned>(f.room), ago);
    if (w < 0) {
        out[0] = '\0';
        return 0;
    }
    return static_cast<std::size_t>(w) < cap ? static_cast<std::size_t>(w)
                                             : cap - 1;
}

} // namespace giga::game
