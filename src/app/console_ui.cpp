#include "app/console_ui.h"
#include <imgui.h>
#include <cfloat>
#include <cstdio>
#include <cstring>

namespace giga {

struct ConsoleUiRefs {
    game::Console* con;
    const game::ConsoleContext* ctx;
    std::vector<std::string>* log;
    std::vector<std::string>* history;
    int* histPos;
};

static int ConsoleInputCallback(ImGuiInputTextCallbackData* data) {
    ConsoleUiRefs& ui = *static_cast<ConsoleUiRefs*>(data->UserData);
    if (data->EventFlag == ImGuiInputTextFlags_CallbackCharFilter)
        return (data->EventChar == '`' || data->EventChar == '~') ? 1 : 0;
    if (data->EventFlag == ImGuiInputTextFlags_CallbackCompletion) {
        const char* cands[16];
        const std::uint32_t n = ui.con->complete(*ui.ctx, data->Buf, cands, 16);
        if (n == 0) return 0;
        int ws = data->BufTextLen;
        while (ws > 0 && data->Buf[ws - 1] != ' ' && data->Buf[ws - 1] != '\t')
            --ws;
        char lcp[128];
        std::snprintf(lcp, sizeof lcp, "%s", cands[0]);
        for (std::uint32_t i = 1; i < n; ++i) {
            std::size_t j = 0;
            while (lcp[j] && cands[i][j] == lcp[j]) ++j;
            lcp[j] = '\0';
        }
        data->DeleteChars(ws, data->BufTextLen - ws);
        data->InsertChars(ws, lcp);
        if (n == 1) data->InsertChars(data->CursorPos, " ");
        if (n > 1) {
            std::string listed;
            for (std::uint32_t i = 0; i < n; ++i) {
                listed += cands[i];
                listed += ' ';
            }
            ui.log->push_back(listed);
        }
        return 0;
    }
    if (data->EventFlag == ImGuiInputTextFlags_CallbackHistory) {
        if (ui.history->empty()) return 0;
        int& pos = *ui.histPos;
        if (data->EventKey == ImGuiKey_UpArrow) {
            if (pos < 0) pos = static_cast<int>(ui.history->size()) - 1;
            else if (pos > 0) --pos;
        } else if (data->EventKey == ImGuiKey_DownArrow) {
            if (pos >= 0 && pos < static_cast<int>(ui.history->size()) - 1) ++pos;
            else pos = -1;
        }
        data->DeleteChars(0, data->BufTextLen);
        if (pos >= 0) data->InsertChars(0, (*ui.history)[pos].c_str());
        return 0;
    }
    return 0;
}

void draw_console_ui(bool* p_open,
                     bool* p_focus,
                     char* inputBuf,
                     std::size_t inputCap,
                     game::Console& con,
                     game::ConsoleContext& ctx,
                     std::vector<std::string>& log,
                     std::vector<std::string>& history,
                     int& histPos) 
{
    if (!*p_open) return;
    const ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(ImVec2(io.DisplaySize.x, io.DisplaySize.y * 0.45f));
    if (!ImGui::Begin("КОНСОЛЬ", p_open,
                      ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize |
                          ImGuiWindowFlags_NoCollapse)) {
        ImGui::End();
        return;
    }
    const float footer =
        ImGui::GetStyle().ItemSpacing.y + ImGui::GetFrameHeightWithSpacing();
    ImGui::BeginChild("##console_log", ImVec2(0, -footer), true,
                      ImGuiWindowFlags_HorizontalScrollbar);
    for (const std::string& s : log) ImGui::TextUnformatted(s.c_str());
    if (ImGui::GetScrollY() >= ImGui::GetScrollMaxY() - 1.0f)
        ImGui::SetScrollHereY(1.0f);
    ImGui::EndChild();

    ConsoleUiRefs ui{&con, &ctx, &log, &history, &histPos};
    ImGui::SetNextItemWidth(-FLT_MIN);
    const ImGuiInputTextFlags flags =
        ImGuiInputTextFlags_EnterReturnsTrue |
        ImGuiInputTextFlags_CallbackCompletion |
        ImGuiInputTextFlags_CallbackHistory |
        ImGuiInputTextFlags_CallbackCharFilter;
    if (*p_focus) {
        ImGui::SetKeyboardFocusHere();
        *p_focus = false;
    }
    if (ImGui::InputText("##console_in", inputBuf, inputCap, flags,
                         ConsoleInputCallback, &ui)) {
        if (inputBuf[0]) {
            log.push_back(std::string("> ") + inputBuf);
            char outMsg[256];
            con.exec(ctx, inputBuf, outMsg, sizeof outMsg);
            if (outMsg[0]) log.push_back(outMsg);
            if (std::strcmp(inputBuf, "help") == 0) {
                for (std::size_t i = 0; i < con.count(); ++i) {
                    const game::ConsoleCommand& c = con.at(i);
                    log.push_back(std::string("  ") + c.usage + " — " + c.help);
                }
            }
            history.push_back(inputBuf);
            histPos = -1;
            inputBuf[0] = '\0';
        }
        *p_focus = true;
    }
    ImGui::End();
}

} // namespace giga
