// Sparse per-SUB-voxel fields over the macro grid — the sub-resolution sibling
// of world/field.h.
//
// A Field<T> gives every macro cell one T. A SubField<T> gives every macro cell
// EITHER one implicit uniform value (costing nothing) OR a dense 8^3 page of T,
// one per sub-voxel. The world's atom becomes the 0.25 m sub-voxel for any
// field that needs it (materials, damage, charge, ...), without paying dense
// cost for the overwhelmingly-uniform bulk of the torus.
//
// Degradation contract ([fields.md] budget): the structure is paged, never
// pointer-chased. Storage is three flat vectors:
//   * pageOf_  — kMacroCells x uint32 page slot, kNoPage when uniform (8 MB);
//   * pages_   — the dense pages actually allocated, kSubVoxels x T each;
//   * free_    — recycled page slots (a page whose cell collapsed back to
//                uniform is reused, not leaked).
// Reads are two indexed loads, no hashing, no branch beyond the sentinel test.
// In the WORST case — every one of the 2^21 cells mixed — a SubField<uint16>
// degrades to exactly the dense array it replaces: 2 GB of pages + the 8 MB
// table. Nothing pathological happens on the way there: memory grows linearly
// with mixed cells, and typical floors (mixed cells only where generators
// painted coats or destruction carved) sit in the tens of MB.
//
// The uniform value is NOT stored here. Each field has a natural per-cell base
// the caller already owns (materials: MacroGrid::cell(); damage: 0), so the
// accessors take it as a parameter instead of duplicating 4 MB per field and
// inventing a sync problem. See sub_material_at() in world/destruct.h for the
// canonical materials binding.
//
// Mutation (ensure_page / drop_page) allocates at most one vector grow and is
// meant for RARE events — generation and destruction — never the per-tick hot
// path ([jirnyak.md] §3: no allocation inside Tick()). reserve_pages() lets a
// generator prepay.
#pragma once
#include <algorithm>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "world/field.h" // TypeTag / type_tag<T> (no-RTTI type identity)
#include "world/types.h"

namespace giga {

template <class T>
class SubField {
public:
    static constexpr std::uint32_t kNoPage = 0xFFFFFFFFu;

    SubField() : pageOf_(kMacroCells, kNoPage) {}

    // --- queries ------------------------------------------------------------
    bool paged(std::size_t ci) const { return pageOf_[ci] != kNoPage; }

    // Value of one sub-voxel. `base` is the cell's uniform value, supplied by
    // the caller (see header note); it is returned verbatim for unpaged cells.
    T at(std::size_t ci, int bit, T base) const {
        const std::uint32_t p = pageOf_[ci];
        return p == kNoPage ? base : pages_[p].v[bit];
    }

    // Toroidal convenience mirroring Field<T>::at.
    T at(int cx, int cy, int cz, int sx, int sy, int sz, T base) const {
        return at(macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz)),
                  sub_bit(sx, sy, sz), base);
    }

    // Direct page access for bulk work; nullptr when the cell is uniform.
    T* page(std::size_t ci) {
        const std::uint32_t p = pageOf_[ci];
        return p == kNoPage ? nullptr : pages_[p].v;
    }
    const T* page(std::size_t ci) const {
        const std::uint32_t p = pageOf_[ci];
        return p == kNoPage ? nullptr : pages_[p].v;
    }

    // Raw flat access for GPU mirrors and serializers — the MacroGrid::types()
    // precedent. pages_data() is the pool as one contiguous T array, slot i at
    // offset i * kSubVoxels; free-listed slots hold stale bytes but nothing in
    // page_table() references them.
    const std::uint32_t* page_table() const { return pageOf_.data(); }
    const T* pages_data() const {
        return pages_.empty() ? nullptr : pages_.front().v;
    }
    std::size_t page_count() const { return pages_.size(); }

    // --- mutation (rare-event path, never per-tick) -------------------------
    // Page the cell if it is not already, filling every sub-voxel with `base`,
    // and return the page. This is the ONLY allocation site.
    T* ensure_page(std::size_t ci, T base) {
        std::uint32_t p = pageOf_[ci];
        if (p == kNoPage) {
            if (!free_.empty()) {
                p = free_.back();
                free_.pop_back();
            } else {
                p = static_cast<std::uint32_t>(pages_.size());
                pages_.emplace_back();
            }
            pageOf_[ci] = p;
            T* v = pages_[p].v;
            for (int i = 0; i < kSubVoxels; ++i) v[i] = base;
            return v;
        }
        return pages_[p].v;
    }

    // Return the cell to uniform, recycling its page slot.
    void drop_page(std::size_t ci) {
        const std::uint32_t p = pageOf_[ci];
        if (p == kNoPage) return;
        free_.push_back(p);
        pageOf_[ci] = kNoPage;
    }

    // If every sub-voxel in the page holds the same value, drop the page and
    // report that value (so the caller can fold it into its per-cell base).
    // Returns false — and leaves the page alone — for uniform-already or
    // genuinely mixed cells.
    bool collapse_if_uniform(std::size_t ci, T* uniform) {
        const std::uint32_t p = pageOf_[ci];
        if (p == kNoPage) return false;
        const T* v = pages_[p].v;
        const T first = v[0];
        for (int i = 1; i < kSubVoxels; ++i)
            if (!(v[i] == first)) return false;
        if (uniform) *uniform = first;
        drop_page(ci);
        return true;
    }

    void reserve_pages(std::size_t n) { pages_.reserve(n); }

    // Return EVERY cell to uniform and release the pages. For wholesale state
    // replacement (a floor snapshot stamping over a live world) — not a per-tick
    // operation.
    void clear() {
        std::fill(pageOf_.begin(), pageOf_.end(), kNoPage);
        pages_.clear();
        free_.clear();
    }

    // --- budget introspection ----------------------------------------------
    std::size_t pages_in_use() const { return pages_.size() - free_.size(); }
    std::size_t bytes() const {
        return pageOf_.capacity() * sizeof(std::uint32_t) +
               pages_.capacity() * sizeof(Page) +
               free_.capacity() * sizeof(std::uint32_t);
    }

private:
    struct Page {
        T v[kSubVoxels];
    };
    static_assert(sizeof(Page) == sizeof(T) * kSubVoxels,
                  "pages must stay tight: pages_data() exposes the pool as one "
                  "contiguous T array with slot stride kSubVoxels");
    std::vector<std::uint32_t> pageOf_;
    std::vector<Page> pages_;
    std::vector<std::uint32_t> free_;
};

// Type-erased registry so sub-fields of different T live in one place, exactly
// mirroring FieldRegistry (same Holder pattern, same no-RTTI type_tag guard).
// Name lookup hashes a string, so — like FieldRegistry — resolve once at load
// or floor-build time and keep the reference; never look up per tick
// ([jirnyak.md] §7).
class SubFieldRegistry {
public:
    template <class T>
    SubField<T>& get_or_create(const std::string& name) {
        auto it = fields_.find(name);
        if (it != fields_.end()) {
            assert(it->second->tag == type_tag<T>() && "SubField type mismatch in get_or_create");
            return *static_cast<SubField<T>*>(it->second->ptr);
        }
        auto holder = std::make_unique<Holder>();
        auto* f = new SubField<T>();
        holder->ptr = f;
        holder->tag = type_tag<T>();
        holder->deleter = [](void* p) { delete static_cast<SubField<T>*>(p); };
        SubField<T>& ref = *f;
        fields_.emplace(name, std::move(holder));
        return ref;
    }

    template <class T>
    SubField<T>* find(const std::string& name) {
        auto it = fields_.find(name);
        if (it == fields_.end()) return nullptr;
        if (it->second->tag != type_tag<T>()) return nullptr;
        return static_cast<SubField<T>*>(it->second->ptr);
    }
    template <class T>
    const SubField<T>* find(const std::string& name) const {
        auto it = fields_.find(name);
        if (it == fields_.end()) return nullptr;
        if (it->second->tag != type_tag<T>()) return nullptr;
        return static_cast<const SubField<T>*>(it->second->ptr);
    }

    bool exists(const std::string& name) const {
        return fields_.count(name) != 0;
    }
    std::size_t count() const { return fields_.size(); }

private:
    struct Holder {
        void* ptr = nullptr;
        const void* tag = nullptr;
        void (*deleter)(void*) = nullptr;
        ~Holder() {
            if (ptr && deleter) deleter(ptr);
        }
    };
    std::unordered_map<std::string, std::unique_ptr<Holder>> fields_;
};

} // namespace giga
