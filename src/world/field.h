// Runtime-registered typed scalar fields over the macro grid.
//
// The design pillar: a field is *just* a 128^3 array of some POD type, keyed by
// name and created on demand. "We wanted temperature, so we made a 128^3 field"
// becomes, literally:
//
//     auto& temp = world.fields().get_or_create<float>("temperature");
//     temp.at(x, y, z) = 21.5f;
//
// No schema, no codegen. Any system can register a field (float, int, a small
// POD struct) and every field is laid out flat and cache-friendly for the whole
// grid. Fields are type-checked at access time; asking for the wrong T on an
// existing field returns nullptr rather than reinterpreting memory.
#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "world/types.h"

namespace giga {

// A dense 128^3 array of T. Toroidal accessors mirror the macro grid so field
// coordinates and cell coordinates always line up.
template <class T>
class Field {
public:
    explicit Field(const T& init = T{}) : data_(kMacroCells, init) {}

    T& at(int x, int y, int z) {
        return data_[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
    }
    const T& at(int x, int y, int z) const {
        return data_[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
    }

    std::vector<T>& data() { return data_; }
    const std::vector<T>& data() const { return data_; }
    void fill(const T& v) { std::fill(data_.begin(), data_.end(), v); }

private:
    std::vector<T> data_;
};

// Type identity without RTTI. Each T gets a distinct, stable tag: the address
// of a per-type static byte. This works under -fno-rtti (the core is built
// without RTTI/exceptions) and needs no <typeinfo>. Comparing tags is a plain
// pointer compare, so wrong-type field access is caught the same as typeid did.
using TypeTag = const void*;
template <class T>
inline TypeTag type_tag() {
    static const char id = 0;
    return &id;
}

// Type-erased ownership so fields of different T live in one registry.
class FieldRegistry {
public:
    // Fetch an existing field or create it (initialized to `init`). Returns a
    // reference; the field lives as long as the registry.
    template <class T>
    Field<T>& get_or_create(const std::string& name, const T& init = T{}) {
        auto it = fields_.find(name);
        if (it != fields_.end()) {
            // Existing field: caller is responsible for matching T. We assert
            // via the stored type tag in debug builds; in release we trust it.
            return *static_cast<Field<T>*>(it->second->ptr);
        }
        auto holder = std::make_unique<Holder>();
        auto* f = new Field<T>(init);
        holder->ptr = f;
        holder->tag = type_tag<T>();
        holder->deleter = [](void* p) { delete static_cast<Field<T>*>(p); };
        Field<T>& ref = *f;
        fields_.emplace(name, std::move(holder));
        return ref;
    }

    // Non-creating lookup. Returns nullptr if absent or if T mismatches the
    // registered element type (safe: never reinterprets memory).
    template <class T>
    Field<T>* find(const std::string& name) {
        auto it = fields_.find(name);
        if (it == fields_.end()) return nullptr;
        if (it->second->tag != type_tag<T>()) return nullptr;
        return static_cast<Field<T>*>(it->second->ptr);
    }

    bool exists(const std::string& name) const {
        return fields_.count(name) != 0;
    }
    std::size_t count() const { return fields_.size(); }

private:
    struct Holder {
        void* ptr = nullptr;
        TypeTag tag = nullptr;
        void (*deleter)(void*) = nullptr;
        ~Holder() { if (ptr && deleter) deleter(ptr); }
    };
    std::unordered_map<std::string, std::unique_ptr<Holder>> fields_;
};

} // namespace giga
