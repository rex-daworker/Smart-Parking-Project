#include <WiFiNINA.h>
#include <ArduinoHttpClient.h>
#include <rgb_lcd.h>

// ===== WIFI =====
char ssid[] = "036-Wifi";
char pass[] = "036luokka";

// ===== BACKEND SERVER =====
char serverAddress[] = "192.168.1.105"; 
int serverPort = 3000;

WiFiClient wifi;
HttpClient client = HttpClient(wifi, serverAddress, serverPort);

// ===== LCD =====
rgb_lcd lcd;

// ===== ULTRASONIC (Grove D3) =====
int ULTRASONIC_PIN = 3;

// ===== LEDs =====
#define GREEN_LED 2
#define RED_LED   4

// ===== STATE =====
unsigned long lastSend = 0;
unsigned long lastLCD = 0;
unsigned long lastPoll = 0;

String cloudAction = "none";
int cloudThreshold = 30;

unsigned long occupiedStart = 0;
bool countedCar = false;

// ---------------------------------------------------
// READ DISTANCE
// ---------------------------------------------------
long readDistance() {
  pinMode(ULTRASONIC_PIN, OUTPUT);
  digitalWrite(ULTRASONIC_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRASONIC_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_PIN, LOW);

  pinMode(ULTRASONIC_PIN, INPUT);
  long duration = pulseIn(ULTRASONIC_PIN, HIGH, 35000);

  if (duration == 0) return -1;
  return duration * 0.0343 / 2;
}

// ---------------------------------------------------
void setup() {
  Serial.begin(9600);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);

  lcd.begin(16, 2);
  lcd.setRGB(20, 80, 255);
  lcd.print("Connecting WiFi");

  while (WiFi.begin(ssid, pass) != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }

  lcd.clear();
  lcd.print("WiFi Connected!");
  delay(600);
}

// ---------------------------------------------------
// POLL CLOUD COMMAND WITH CLEAN HTTP CLIENT
// ---------------------------------------------------
void pollCommand() {

  HttpClient cmd(wifi, serverAddress, serverPort);   // NEW CLEAN CLIENT

  cmd.get("/command");

  int statusCode = cmd.responseStatusCode();
  String response = cmd.responseBody();

  Serial.print("CMD RAW: ");
  Serial.println(response);

  if (statusCode != 200 || response.indexOf("\"action\"") == -1) {
    Serial.println("Invalid command JSON");
    cmd.stop();
    return;
  }

  // ---- Parse action ----
  int aIndex = response.indexOf("\"action\":\"") + 10;
  int aEnd = response.indexOf("\"", aIndex);
  cloudAction = response.substring(aIndex, aEnd);

  // ---- Parse threshold ----
  int tIndex = response.indexOf("\"threshold\":") + 12;
  int tEnd = response.indexOf("}", tIndex);
  cloudThreshold = response.substring(tIndex, tEnd).toInt();

  Serial.print("Parsed action: ");
  Serial.println(cloudAction);

  Serial.print("Parsed threshold: ");
  Serial.println(cloudThreshold);

  lcd.clear();
  lcd.print("Cmd:");
  lcd.print(cloudAction);

  cmd.stop();
}

// ---------------------------------------------------
void loop() {

  long d = readDistance();

  String status;
  if (d <= 0 || d > 500) status = "unknown";
  else if (d <= cloudThreshold) status = "occupied";
  else status = "free";

  // ---- Track “car inside >3 min” ----
  if (status == "occupied") {
    if (occupiedStart == 0) occupiedStart = millis();
    if (!countedCar && millis() - occupiedStart >= 180000) {
      lcd.clear();
      lcd.print("Car inside >3min");
      countedCar = true;
    }
  } else {
    occupiedStart = 0;
    countedCar = false;
  }

  // ---- LCD update ----
  if (millis() - lastLCD > 150) {

    lcd.setCursor(0, 0);
    lcd.print("Dist:");
    lcd.print(d);
    lcd.print("cm   ");

    lcd.setCursor(0, 1);

    if (cloudAction == "close") {
      lcd.print("Gate CLOSED     ");
    } else if (cloudAction == "open") {
      lcd.print("Gate OPEN       ");
    } else {
      lcd.print("Status:");
      lcd.print(status);
      lcd.print("   ");
    }

    lastLCD = millis();
  }

  // ---- Send data to cloud ----
  if (millis() - lastSend > 1000) {

    String json = "{";
    json += "\"slot\":\"SLOT1\",";
    json += "\"distance\":" + String(d) + ",";
    json += "\"status\":\"" + status + "\"";
    json += "}";

    client.beginRequest();
    client.post("/update");
    client.sendHeader("Content-Type", "application/json");
    client.sendHeader("Content-Length", json.length());
    client.beginBody();
    client.print(json);
    client.endRequest();
    client.stop();    // IMPORTANT FIX

    Serial.println("Sent: " + json);

    lastSend = millis();
  }

  // ---- Poll cloud every 2 sec ----
  if (millis() - lastPoll > 2000) {
    pollCommand();
    lastPoll = millis();
  }

  delay(50);
}
