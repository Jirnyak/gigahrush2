// Реализация системы присутствия. Закон, выводы и причины — в [sim/presence.h];
// здесь только механика.
//
// ФАЙЛОВЫЕ СТАТИКИ, А НЕ ОБЪЕКТ-ВЛАДЕЛЕЦ: присутствие единственно по
// построению (ровно та единственность, которую держит правило в
// [tools/check_source_rules.cmake]), и второй экземпляр был бы вторым
// ответом на вопрос «где наблюдатель». Та же форма, что у статик-таблицы ламп
// этажа: «этаж один, владелец один». Петля кадра однопоточная — центры ставит
// app, запросы зовут потребители того же кадра.
#include "sim/presence.h"

#include <cstdio>
#include <limits>

#include "ecs/components.h"

namespace giga {
namespace {

struct Consumer {
    const char* name = nullptr;
    const char* costSource = nullptr;
    PresenceLevel level = PresenceLevel::kFull;
    PresenceClass cls = PresenceClass::kFreeze;
    float budgetMs = 0.0f;
    float costUs = 0.0f;
    std::uint32_t n = 0;
    // Прибор потребителя: что он видел в ПОСЛЕДНИЙ раз и сколько выкинул за
    // всё время. Последнее — чтобы строка отчёта отвечала про сейчас;
    // накопленное — чтобы редкий отброс не утонул между печатями.
    std::uint32_t lastConsidered = 0;
    std::uint32_t lastEligible = 0;
    std::uint32_t lastPassed = 0;
    std::uint64_t totalDroppedByRadius = 0;
    std::uint64_t totalDroppedByBudget = 0;
    std::uint64_t totalQueries = 0;
};

Consumer g_consumers[kMaxPresenceConsumers];
std::uint32_t g_consumerCount = 0;

vec3 g_centers[kMaxPresenceCenters];
std::uint32_t g_centerCount = 0;
std::uint64_t g_centersDropped = 0;

bool g_forceInfinite = false;
std::uint32_t g_generation = 0;

const char* level_name(PresenceLevel l) {
    return l == PresenceLevel::kFull ? "full" : "visible";
}
const char* class_name(PresenceClass c) {
    return c == PresenceClass::kFreeze ? "freeze/класс1" : "coarsen/класс2";
}

} // namespace

float presence_level_radius(PresenceLevel level) {
    // Шов гейта коммутации: «радиус ∞» — ОДИН флаг в ОДНОМ месте, и он обязан
    // проходить именно через эту дверь, иначе потребитель, читающий радиус
    // мимо неё, останется конечным в прогоне «всё живое» и дайджест сойдётся
    // по неверной причине.
    if (g_forceInfinite) return std::numeric_limits<float>::infinity();
    return level == PresenceLevel::kFull ? kPresenceFullRadius
                                         : kPresenceVisibleRadius;
}

void presence_set_centers(const vec3* centers, std::uint32_t n) {
    g_centerCount = 0;
    if (!centers) return;
    for (std::uint32_t i = 0; i < n; ++i) {
        if (g_centerCount >= kMaxPresenceCenters) {
            ++g_centersDropped; // печатается presence_report — молча не режем
            continue;
        }
        g_centers[g_centerCount++] = centers[i];
    }
}

std::uint32_t presence_center_count() { return g_centerCount; }

PresenceId presence_register(const PresenceRegistration& reg) {
    if (reg.name == nullptr || *reg.name == '\0') {
        std::fprintf(stderr,
                     "[presence] ОТКАЗ: потребитель без имени. Белый список "
                     "обязан быть поимённым (matwej.md §23.6) — строка в "
                     "отчёте и есть доказательство, что регистрация законна.\n");
        return kInvalidPresenceId;
    }
    if (!(reg.cost_per_item_us > 0.0f)) {
        std::fprintf(stderr,
                     "[presence] ОТКАЗ '%s': cost_per_item_us = %.3f. Цена "
                     "штуки обязана быть ЗАМЕРОМ: ноль даёт N = ∞, то есть "
                     "'бюджета нет', одетое в язык бюджета. Померь свой проход "
                     "и назови сцену.\n",
                     reg.name, static_cast<double>(reg.cost_per_item_us));
        return kInvalidPresenceId;
    }
    if (reg.cost_source == nullptr || *reg.cost_source == '\0') {
        std::fprintf(stderr,
                     "[presence] ОТКАЗ '%s': цена есть, источника замера нет. "
                     "Число без происхождения — дефект (закон «константы "
                     "обязаны выводиться»): назови документ, строку и сцену.\n",
                     reg.name);
        return kInvalidPresenceId;
    }
    if (g_consumerCount >= kMaxPresenceConsumers) {
        std::fprintf(stderr,
                     "[presence] ОТКАЗ '%s': таблица потребителей полна (%u). "
                     "Это размер встроенной таблицы, а не правило мира — "
                     "поднимай kMaxPresenceConsumers вместе с новым выводом.\n",
                     reg.name, kMaxPresenceConsumers);
        return kInvalidPresenceId;
    }

    const PresenceId id = g_consumerCount++;
    Consumer& c = g_consumers[id];
    c.name = reg.name;
    c.costSource = reg.cost_source;
    c.level = reg.level;
    c.cls = reg.cls;
    c.budgetMs = reg.budget_ms;
    c.costUs = reg.cost_per_item_us;
    // ВЫВОД N — ОДНА СТРОКА, И ОНА ЖЕ ЕДИНСТВЕННОЕ МЕСТО, ГДЕ N РОЖДАЕТСЯ.
    // Усечение вниз, не округление: N — это «сколько штук УКЛАДЫВАЕТСЯ в
    // бюджет», и штука, влезающая наполовину, бюджет превышает.
    c.n = static_cast<std::uint32_t>(c.budgetMs * 1000.0f / c.costUs);

    // Печать при регистрации, а не только в отчёте: потребитель, чей N никто
    // не увидел, — это N без напечатанного вывода, то есть дефект (§23.6).
    std::fprintf(stderr,
                 "[presence] register '%s': level=%s (R=%.1f м) class=%s | "
                 "N = %.3f мс × 1000 / %.3f мкс = %u | цена: %s\n",
                 c.name, level_name(c.level),
                 static_cast<double>(presence_level_radius(c.level)),
                 class_name(c.cls), static_cast<double>(c.budgetMs),
                 static_cast<double>(c.costUs), c.n, c.costSource);
    return id;
}

std::uint32_t presence_budget_n(PresenceId id) {
    return id < g_consumerCount ? g_consumers[id].n : 0;
}

float presence_radius(PresenceId id) {
    if (id >= g_consumerCount) return 0.0f;
    return presence_level_radius(g_consumers[id].level);
}

std::uint32_t presence_consumer_count() { return g_consumerCount; }

std::uint32_t presence_generation() { return g_generation; }

std::uint32_t presence_query(PresenceId id, const CellBins& bins,
                             const Registry& reg, CellBins::Near* out,
                             std::uint32_t outCap) {
    if (id >= g_consumerCount || out == nullptr) return 0;
    Consumer& c = g_consumers[id];
    ++c.totalQueries;
    c.lastConsidered = static_cast<std::uint32_t>(bins.entries.size());
    c.lastEligible = 0;
    c.lastPassed = 0;
    if (g_centerCount == 0) {
        // Центров нет — наблюдателя нет. Это НЕ «всё внутри» и не «всё
        // снаружи»: это «спрашивать не у кого», и ответ пустой. Кадр без
        // камеры в этом движке существует (вход на этаж до посадки тела).
        c.totalDroppedByRadius += c.lastConsidered;
        return 0;
    }

    // Счёт: при прогоне «всё живое» бюджета нет вовсе — иначе дайджест сошёлся
    // бы по неверной причине (радиус ∞ при N = 128 это по-прежнему пузырь).
    const std::uint32_t budget = g_forceInfinite ? outCap : c.n;
    const std::uint32_t cap = budget < outCap ? budget : outCap;

    // Позиция записи — её `Transform`. Сущности без него не существует как
    // места: вернуть ей ноль значило бы поставить её в начало координат и
    // втянуть в пузырь оттуда. NaN не проходит сравнение с радиусом ни при
    // каком радиусе, включая ∞, — и попадает в отброшенные, то есть в печать.
    const float noPos = std::numeric_limits<float>::quiet_NaN();
    auto pos = [&reg, noPos](Entity e) -> vec3 {
        if (!reg.all_of<Transform>(e)) return vec3{noPos, noPos, noPos};
        return reg.get<const Transform>(e).pos;
    };

    std::uint32_t eligible = 0;
    const std::uint32_t got = bins.nearest_in_radius(
        g_centers, g_centerCount, presence_level_radius(c.level), kWorldExtent,
        pos, out, cap, &eligible);
    c.lastEligible = eligible;
    c.lastPassed = got;
    c.totalDroppedByRadius += c.lastConsidered - eligible;
    c.totalDroppedByBudget += eligible - got;
    return got;
}

void presence_note(PresenceId id, std::uint32_t considered,
                   std::uint32_t passed) {
    if (id >= g_consumerCount) return;
    Consumer& c = g_consumers[id];
    ++c.totalQueries;
    c.lastConsidered = considered;
    c.lastEligible = passed;
    c.lastPassed = passed;
    c.totalDroppedByRadius += considered >= passed ? considered - passed : 0;
}

void presence_force_infinite(bool on) {
    if (g_forceInfinite == on) return;
    g_forceInfinite = on;
    std::fprintf(stderr,
                 "[presence] радиус %s — это ПРОГОН ГЕЙТА КОММУТАЦИИ "
                 "(matwej.md §23.1), не режим игры\n",
                 on ? "= ∞, счёт не ограничен" : "вернулся к номиналу");
}

bool presence_forced_infinite() { return g_forceInfinite; }

void presence_report() {
    std::fprintf(stderr,
                 "[presence] центров %u/%u (отброшено за прогон %llu) | "
                 "уровни: full %.1f м, visible %.1f м (НОМИНАЛ, без погодного "
                 "множителя) | потребителей %u/%u%s\n",
                 g_centerCount, kMaxPresenceCenters,
                 static_cast<unsigned long long>(g_centersDropped),
                 static_cast<double>(kPresenceFullRadius),
                 static_cast<double>(kPresenceVisibleRadius), g_consumerCount,
                 kMaxPresenceConsumers,
                 g_forceInfinite ? " | РАДИУС ∞ (прогон гейта)" : "");
    if (g_consumerCount == 0) {
        // Пустой белый список — не ошибка, но и не молчание: система без
        // потребителей есть мёртвый груз, и строка об этом говорит прямо.
        std::fprintf(stderr,
                     "[presence] белый список ПУСТ — ни один потребитель не "
                     "зарегистрирован\n");
        return;
    }
    for (std::uint32_t i = 0; i < g_consumerCount; ++i) {
        const Consumer& c = g_consumers[i];
        std::fprintf(stderr,
                     "[presence]   '%s' %s R=%.1f %s | N=%u (%.3f мс / %.3f "
                     "мкс) | последний запрос: рассмотрено %u, в радиусе %u, "
                     "выдано %u | за прогон отброшено: радиусом %llu, бюджетом "
                     "%llu, запросов %llu | цена: %s\n",
                     c.name, level_name(c.level),
                     static_cast<double>(presence_level_radius(c.level)),
                     class_name(c.cls), c.n, static_cast<double>(c.budgetMs),
                     static_cast<double>(c.costUs), c.lastConsidered,
                     c.lastEligible, c.lastPassed,
                     static_cast<unsigned long long>(c.totalDroppedByRadius),
                     static_cast<unsigned long long>(c.totalDroppedByBudget),
                     static_cast<unsigned long long>(c.totalQueries),
                     c.costSource);
    }
}

void presence_reset() {
    for (std::uint32_t i = 0; i < kMaxPresenceConsumers; ++i)
        g_consumers[i] = Consumer{};
    g_consumerCount = 0;
    g_centerCount = 0;
    g_centersDropped = 0;
    g_forceInfinite = false;
    ++g_generation; // кэшированные id потребителей стали ложью — см. шапку
}

} // namespace giga
