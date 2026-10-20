# Builds the simulator: LVGL + the firmware's ui/ + sim/ -> WebAssembly in dist/.
# Run through build/build.sh, which sets up Emscripten and picks the firmware repo.
cmake_minimum_required(VERSION 3.20)
project(watch_sim C)

set(SIM_DIR  ${CMAKE_CURRENT_LIST_DIR}/..)
set(LVGL_DIR ${SIM_DIR}/third_party/lvgl)
set(GEN_DIR  ${CMAKE_BINARY_DIR}/generated)
set(FW_DIR   "" CACHE PATH "Firmware repo to build (the folder with ui/ and prj.conf)")
set(DIST_DIR ${SIM_DIR}/dist CACHE PATH "Where the static web files go")

if(NOT EXISTS ${FW_DIR}/prj.conf)
  message(FATAL_ERROR "FW_DIR=${FW_DIR} has no prj.conf")
endif()

# prj.conf -> generated/lv_autoconf.h (the CONFIG_LV_* values Zephyr would produce)
add_custom_command(
  OUTPUT ${GEN_DIR}/lv_autoconf.h
  COMMAND python3 ${SIM_DIR}/tools/gen_lv_autoconf.py ${LVGL_DIR} ${FW_DIR}/prj.conf ${GEN_DIR}/lv_autoconf.h
  DEPENDS ${FW_DIR}/prj.conf ${SIM_DIR}/tools/gen_lv_autoconf.py
  COMMENT "Generating LVGL config from prj.conf")
add_custom_target(lv_autoconf DEPENDS ${GEN_DIR}/lv_autoconf.h)

# Settings shared by LVGL and the firmware code. Zephyr force-includes its autoconf.h
# into every file; -include does the same with the generated header.
add_library(sim_config INTERFACE)
target_include_directories(sim_config INTERFACE ${LVGL_DIR} ${SIM_DIR}/build ${SIM_DIR}/sim ${GEN_DIR})
target_compile_definitions(sim_config INTERFACE LV_CONF_INCLUDE_SIMPLE=1)
target_compile_options(sim_config INTERFACE -include ${GEN_DIR}/lv_autoconf.h)

# LVGL, compiled once and reused until lv_autoconf.h changes
file(GLOB_RECURSE LVGL_SOURCES ${LVGL_DIR}/src/*.c)
add_library(lvgl STATIC ${LVGL_SOURCES} ${SIM_DIR}/sim/lvgl_mem.c)
target_link_libraries(lvgl PUBLIC sim_config)
target_compile_options(lvgl PRIVATE -O2 -w)
add_dependencies(lvgl lv_autoconf)

# The firmware's portable code. CONFIGURE_DEPENDS picks up new .c files on each build.
file(GLOB_RECURSE FW_SOURCES CONFIGURE_DEPENDS ${FW_DIR}/ui/*.c)

add_executable(watch ${SIM_DIR}/sim/main.c ${FW_SOURCES})
target_include_directories(watch PRIVATE ${FW_DIR}/ui)
target_link_libraries(watch PRIVATE lvgl)
# Close to Zephyr's flags, so code that warns there warns here
target_compile_options(watch PRIVATE -O1 -std=c99 -Wall -Wno-pointer-sign -Wpointer-arith
  -Werror=implicit-int -Werror=implicit-function-declaration)
target_link_options(watch PRIVATE
  -sMODULARIZE=1 -sEXPORT_NAME=createWatch   # createWatch() starts a fresh copy
  -sENVIRONMENT=web
  -sEXPORTED_RUNTIME_METHODS=HEAPU8          # lets sim.js read the panel pixels
  -sINITIAL_MEMORY=32MB)
set_target_properties(watch PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${DIST_DIR}
  SUFFIX ".js")

# Copy the web page next to watch.js / watch.wasm
file(GLOB WEB_FILES CONFIGURE_DEPENDS ${SIM_DIR}/web/*)
add_custom_command(TARGET watch POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different ${WEB_FILES} ${DIST_DIR})
