# Bill of Materials

Parts to build one unit. Total ≈ $55–80 USD depending on source.

## Core electronics

| Part | Qty | Approx | Notes |
|---|---|---|---|
| Waveshare 7.5" e-Paper V2 (model 075BN-T7-D2 / driver GDEY075T7) | 1 | $40 | The display. |
| Waveshare e-Paper ESP32 Driver Board Rev3 | 1 | $20 | Has the connector, voltage regulator, deep-sleep support. |
| 3.7V LiPo, 2500 mAh, JST-PH 2.0 | 1 | $8 | Powers the unit between USB charges. |
| TP4056 USB-C charging module (with protection) | 1 | $2 | Wired between USB-C and the LiPo. |
| Tactile push buttons, 6×6mm | 3 | $1 | Units toggle, refresh, screen-cycle. |
| HC-SR501 PIR sensor | 1 | $2 | Wake on motion. (Optional — works without.) |
| 10kΩ resistors | 4 | $0.50 | Pull-downs for GPIO 35/39 (no internal pull-down on those pins). |
| Hookup wire, 22AWG, ~3 colors | – | $3 | |

## Frame

Pick one:

- **3D-printed frame** — STL files in `frame/` (TODO: not yet committed). Two pieces, M2 screws hold it together.
- **Acrylic + standoffs** — laser-cut from `frame/eink-front.svg` (TODO). 3mm acrylic, M2 hex standoffs ×4.
- **Cardboard prototype** — print the SVG, cut by hand, glue with the LiPo + driver board behind.

## GPIO assignments

Already soldered in the firmware (`esp32/weather_station.ino`). Don't reassign:

```
EPD_BUSY = 25
EPD_RST  = 26
EPD_DC   = 27
EPD_CS   = 15
EPD_SCK  = 13
EPD_MOSI = 14    (HSPI bus, NOT VSPI)

BATTERY_PIN = 34  (analog, via 2:1 voltage divider)

BTN_UNITS    = 32
BTN_REFRESH  = 33
BTN_SCREEN   = 35  (external 10kΩ pull-down required)
PIR_PIN      = 39  (external 10kΩ pull-down required)
```

## Where to source

- **Display + driver board**: Waveshare official site, or Amazon (search "Waveshare 7.5 e-Paper ESP32"). The kit form is $55 if you buy both together.
- **LiPo + TP4056**: AliExpress in lots of 5–10, ~$2 each. Adafruit / Pimoroni for guaranteed-protected cells if you're nervous about fire.
- **Buttons / PIR / resistors**: any electronics kit, or Amazon "starter kit" for $15 covers all of these and then some.

## Notes

- Buttons connect to the GPIO pin and 3.3V — external pull-downs to GND. **Don't** wire them between GPIO and GND with internal pull-up; the ESP32 ext1 wake mask works best with active-HIGH wake.
- The PIR's signal pin is active-HIGH out of the box. Same wake convention.
- Battery sense: 100kΩ + 100kΩ divider from VBAT → GPIO 34. ADC reads 0–2.05V (half of full 4.1V LiPo).
- Charging happens via the TP4056 board when USB-C is plugged. The driver board has its own USB-C but ignore it — feed power from the TP4056's output rails directly to the driver board's 3.3V rail.

## Estimated build time

- Solder + assemble: 60–90 min.
- Initial flash + WiFi setup: 15 min.
- Drilling / mounting in your chosen frame: variable.
