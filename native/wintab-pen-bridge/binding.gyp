{
  "targets": [
    {
      "target_name": "wintab_pen_bridge",
      "sources": [
        "src/wintab_pen_bridge.cc"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "UNICODE",
        "_UNICODE",
        "WIN32_LEAN_AND_MEAN",
        "NOMINMAX"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/std:c++20"
          ]
        }
      }
    }
  ]
}
