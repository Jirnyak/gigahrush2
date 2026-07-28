// ECS registry alias.
//
// The engine uses EnTT directly; this header just gives the core a stable name
// to depend on so call sites read `giga::Registry` instead of leaking the
// third-party type everywhere. Built with ENTT_NOEXCEPTION (see CMake) so it
// stays consistent with the engine's -fno-exceptions core.
#pragma once
#include <entt/entt.hpp>

namespace giga {

using Registry = entt::registry;
using Entity = entt::entity;

} // namespace giga
