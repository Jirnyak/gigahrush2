// Camera system: derives view + projection matrices from whichever entity
// currently holds a CameraTag.
//
// The camera is not a singleton object; it is read off the ECS each frame. Move
// the CameraTag to a different entity and the view follows. Returns the first
// camera entity found, or a sane identity fallback if none exists.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h"

namespace giga {

struct CameraMatrices {
    mat4 view = mat4_identity();
    mat4 proj = mat4_identity();
    vec3 eye{0, 0, 0};
    vec3 forward{1, 0, 0};
    bool valid = false;
};

// aspect = drawable width / height. up = world up vector (defaults to +Z).
CameraMatrices compute_camera(Registry& reg, float aspect,
                              vec3 up = vec3{0.0f, 0.0f, 1.0f});

// ТОЧКИ ВЗГЛЯДА — та же дверь, СУЖЕННАЯ, а не вторая (§24.1 п.5).
//
// Закон точки взгляда — `Transform.pos + CameraTag.eyeOffset` — был выписан
// ДВАЖДЫ (`compute_camera` и `compute_stereo_camera`); теперь он живёт в одном
// выражении, и обе матричные функции зовут его же. Отдельный вход нужен
// потребителю, которому матрицы не нужны вовсе: система присутствия
// ([sim/presence.h]) просит ЦЕНТРЫ ПУЗЫРЯ, и просит их в сим-секции кадра, где
// aspect свапчейна ещё не существует. Подсовывать фальшивый aspect, чтобы
// получить `eye` из `CameraMatrices`, значило бы считать проекцию в выброс и
// врать параметром.
//
// МНОЖЕСТВЕННОЕ ЧИСЛО С ПЕРВОГО ДНЯ: [netcode.md] объявляет
// server-authoritative с первого дня, сессия там несёт свой воплощённый аватар
// с `CameraTag`, и два игрока дают две точки взгляда. Сегодня камера одна
// (`compute_camera` берёт первую найденную), поэтому функция вернёт 1 — но
// форма уже та, которая не потребует переписывать потребителей.
//
// Возвращает число записанных точек (≤ cap), порядок — порядок обхода вида.
std::uint32_t camera_eyes(const Registry& reg, vec3* out, std::uint32_t cap);

// Пара глаз — левый и правый, разведённые на базу стерео.
struct StereoCameraMatrices {
    CameraMatrices left;
    CameraMatrices right;
    bool valid = false;
};

// Межзрачковое расстояние по умолчанию, метры.
//
// ВЫВОД: антропометрия, не вкус. Средний взрослый IPD — 63–65 мм по
// измерениям (мужчины ~64, женщины ~62); 0.064 попадает в середину и совпадает
// с дефолтом, который держат шлемы. Число живое: пользовательская настройка
// правит его в пределах [0.030, 0.100] — детский и широкий край той же
// выборки.
inline constexpr float kDefaultIpd = 0.064f;

// Границы пользовательской настройки IPD, метры. ВЫВОД: та же выборка, её
// края. 0.050 — детский/узкий край взрослой популяции, 0.078 — широкий; за
// этими границами стереопара перестаёт быть парой глаз и становится ручкой
// «силы 3D», а такая ручка врёт про масштаб мира. Крутить силу эффекта — это
// крутить РАЗМЕР СЕБЯ: мир с IPD 0.15 м читается вдвое меньше настоящего.
inline constexpr float kMinIpd = 0.050f;
inline constexpr float kMaxIpd = 0.078f;

// Стереопара от той же камеры, что и compute_camera: оба глаза смотрят ПО ОДНОЙ
// оси (параллельная проекция, без свода на точку), разведённые на ipd вдоль
// правого вектора взгляда. Свод (toe-in) сюда сознательно не заведён: он даёт
// вертикальный параллакс по краям кадра и режет глаза — стереобазу разводят
// сдвигом, а глубину набирает сам мозг.
//
// `eyeAspect` — соотношение сторон ОДНОГО глаза: при Side-by-Side это
// (ширина/2)/высота, а не аспект окна.
//
// СЕЙЧАС ЭТО ЗАГОТОВКА: к пассам она не подключена (решение владельца
// 2026-09-12 — стерео удваивает работу raymarch, который и есть 83% кадра,
// [problems.md] §67.2). Математика лежит отдельно и под гейтом, чтобы
// подключение было одним коммитом, а не повторным выводом.
StereoCameraMatrices compute_stereo_camera(Registry& reg, float eyeAspect,
                                           float ipd = kDefaultIpd,
                                           vec3 up = vec3{0.0f, 0.0f, 1.0f});

// Forward direction from yaw/pitch, shared by camera + input so mouselook and
// movement agree on where "forward" points.
vec3 camera_forward(float yaw, float pitch);

} // namespace giga
