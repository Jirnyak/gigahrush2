// Профиль кадра ([core/prof.h]) — кольцо замеров и его сводка.
//
// Что запинено: медиана/p90/пик на известных данных (порядок вставки не
// важен), честность частично заполненного кольца, вытеснение по кругу
// (старые кадры уходят, свод считается ТОЛЬКО по последним kCap), пустое
// кольцо = нули без деления на ноль. Это единственная математика профиля —
// если она врёт, врут все строки [prof] у владельца; врать молча ей не
// даёт этот файл. Мутация «median = tmp[0]» или «peak = tmp[0]» валит
// каждый из блоков ниже.
static void test_prof_ring_all() {
    using giga::prof::Ring;
    using giga::prof::ring_stats;
    using giga::prof::Stats;

    // Пустое кольцо: нулевая сводка, без чтения мусора.
    {
        Ring r;
        const Stats s = ring_stats(r);
        CHECK(s.median == 0.0f);
        CHECK(s.p90 == 0.0f);
        CHECK(s.peak == 0.0f);
    }

    // Частично заполненное, порядок обратный: статистика от значений, не от
    // порядка. 1..9 мс: медиана tmp[4]=5, p90 tmp[8]=9 (n*9/10=8), пик 9.
    {
        Ring r;
        for (int i = 9; i >= 1; --i) r.push(static_cast<float>(i));
        CHECK(r.count() == 9u);
        const Stats s = ring_stats(r);
        CHECK(s.median == 5.0f);
        CHECK(s.p90 == 9.0f);
        CHECK(s.peak == 9.0f);
    }

    // Один выброс среди ровных кадров: медиана его НЕ видит, пик видит —
    // ровно то разделение, ради которого свод печатает обе колонки.
    {
        Ring r;
        for (int i = 0; i < 100; ++i) r.push(2.0f);
        r.push(50.0f);
        const Stats s = ring_stats(r);
        CHECK(s.median == 2.0f);
        CHECK(s.peak == 50.0f);
    }

    // Вытеснение: kCap старых кадров по 100 мс полностью вымыты kCap новых
    // по 1 мс — сводка обязана забыть прошлую эпоху целиком.
    {
        Ring r;
        for (std::uint32_t i = 0; i < Ring::kCap; ++i) r.push(100.0f);
        for (std::uint32_t i = 0; i < Ring::kCap; ++i) r.push(1.0f);
        CHECK(r.count() == Ring::kCap);
        const Stats s = ring_stats(r);
        CHECK(s.median == 1.0f);
        CHECK(s.peak == 1.0f);
    }

    // Полное кольцо + один лишний: ушёл ровно САМЫЙ СТАРЫЙ. Пишем 0..255,
    // затем 256: значение 0 вытеснено, минимум по кольцу теперь 1.
    {
        Ring r;
        for (std::uint32_t i = 0; i <= Ring::kCap; ++i)
            r.push(static_cast<float>(i));
        const Stats s = ring_stats(r);
        CHECK(s.peak == static_cast<float>(Ring::kCap));
        float mn = s.peak;
        for (std::uint32_t i = 0; i < r.count(); ++i)
            if (r.v[i] < mn) mn = r.v[i];
        CHECK(mn == 1.0f);
    }
}
