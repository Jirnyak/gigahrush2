#include <cstdlib>
#include <cstdio>
#include "core/tick.h"

namespace {

static void test_architecture_gates() {
    int ret = std::system("node tests/check_architecture.js");
    if (ret != 0) {
        ret = std::system("node ../tests/check_architecture.js");
    }
    CHECK(ret == 0);
}

} // namespace
