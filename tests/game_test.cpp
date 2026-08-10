int g_checks = 0;
int g_fails = 0;

#define CHECK(cond) \
    do { \
        ++g_checks; \
        if (!(cond)) { \
            ++g_fails; \
            std::fprintf(stderr, "FAIL: %s at %s:%d\n", #cond, __FILE__, __LINE__); \
        } \
    } while (0)

#include "suite_gas.inl"


int main() {
    std::fprintf(stderr, "Entering test_gas_chemistry_all...\n");
    test_gas_chemistry_all();
    std::fprintf(stderr, "Finished gas chemistry tests. checks: %d fails: %d\n", g_checks, g_fails);
    return g_fails;
}
