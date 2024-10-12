const request = require("requestretry");

let hap;

module.exports = function(api) {
  hap = api.hap;
  api.registerAccessory("homebridge-aristonnet", "AristonNet", AristonWaterHeater);
}

class AristonWaterHeater {
  constructor(log, config, api) {
    this.log = log;
    this.username = config["username"] || "";
    this.password = config["password"] || "";
    this.plantID = config["plantID"] || "";
    this.model = config["model"] || "VELIS Tech Dry";
    this.serial_number = config["serial_number"] || "123456789";

    this.interval = 600; // Thời gian cập nhật (600 giây)
    this.temperature = 10; // Nhiệt độ khởi tạo tối thiểu
    this.powerState = false; // Khởi tạo trạng thái bật/tắt
    this.token = null; // Token cho API

    // Khởi tạo thông tin thiết bị
    this.informationService = new hap.Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(hap.Characteristic.Name, this.model)
      .setCharacteristic(hap.Characteristic.Manufacturer, "Ariston")
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial_number);

    // Khởi tạo dịch vụ bật/tắt và nhiệt độ
    this.thermostatService = new hap.Service.Switch(this.model); // Sử dụng Switch cho chức năng bật/tắt

    // Thêm chức năng bật/tắt thiết bị
    this.thermostatService
      .getCharacteristic(hap.Characteristic.On)
      .onGet(this.getPowerState.bind(this))
      .onSet(this.setPowerState.bind(this));

    // Đăng nhập vào API
    this.loginToAPI();
  }

  // Cung cấp các dịch vụ
  getServices() {
    return [this.informationService, this.thermostatService];
  }

  // Trả về trạng thái bật/tắt
  getPowerState() {
    return this.powerState;
  }

  // Đặt trạng thái bật/tắt
  async setPowerState(value) {
    this.powerState = value;
    this.log("Setting power state to: " + value);
    await this.controlDevicePower(value);
  }

  // Đăng nhập vào API và lưu token
  loginToAPI() {
    const loginData = {
      usr: this.username,
      pwd: this.password,
      imp: false,
      notTrack: true,
      appInfo: {
        os: 2,
        appVer: "5.6.7772.40151",
        appId: "com.remotethermo.aristonnet"
      }
    };

    request.post({
      url: 'https://www.ariston-net.remotethermo.com/api/v2/accounts/login',
      body: JSON.stringify(loginData),
      headers: {
        'Accept': 'application/json, text/json, text/x-json, text/javascript, application/xml, text/xml',
        'Content-Type': 'application/json'
      },
      json: true,
      maxAttempts: 3,
      retryDelay: 6000,
      retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
      rejectUnauthorized: false
    }, (err, resp, body) => {
      if (err || resp.statusCode !== 200) {
        this.log("Error logging in: " + (err || resp.statusCode));
        return;
      }
      
      this.token = body.token; // Lưu token
      this.log("Successfully logged in. Token: " + this.token);
      
      // Cập nhật dữ liệu từ thiết bị
      this.updateDeviceData();
      setInterval(this.updateDeviceData.bind(this), this.interval * 1000);
    });
  }

  // Cập nhật dữ liệu từ thiết bị
  updateDeviceData() {
    this.log("Updating temperature");
    this.getTemperatureAPI();
  }

  // Điều chỉnh nhiệt độ
  async setTemperature(newTemperature) {
    const oldTemperature = this.temperature; // Lưu nhiệt độ cũ
    const data = {
      eco: false,
      new: newTemperature,
      old: oldTemperature
    };

    try {
      const response = await request.post({
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantID}/temperature`,
        headers: {
          'ar.authToken': this.token, // Thêm token vào tiêu đề
          'Accept': 'application/json, text/json, text/x-json, text/javascript, application/xml, text/xml',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data), // Gửi dữ liệu với nhiệt độ mới và cũ
        json: true,
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false,
      });

      if (response.statusCode === 200 && response.body.success) {
        this.temperature = newTemperature; // Cập nhật nhiệt độ
        this.log("Successfully changed temperature to: " + newTemperature);
      } else {
        throw new Error(`Failed to change temperature: ${response.statusCode}`);
      }
    } catch (error) {
      this.log("Error setting temperature: " + error);
    }
  }

  // Hàm lấy nhiệt độ từ API của Ariston
  getTemperatureAPI() {
    request({
      url: `https://www.ariston-net.remotethermo.com/api/v2/velis/plantData/${this.plantID}`,
      headers: {
        'ar.authToken': this.token // Thêm token vào tiêu đề
      },
      jar: true,
      json: true,
      maxAttempts: 3,
      retryDelay: 6000,
      retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
      rejectUnauthorized: false
    }, (err, resp, body) => {
      if (err || resp.statusCode !== 200) {
        this.log("Error fetching temperature data: " + (err || resp.statusCode));
        return;
      }

      // Cập nhật nhiệt độ
      this.temperature = body.temp || 10; // Đảm bảo nhiệt độ không dưới mức tối thiểu
      this.log("Success updating temperature: " + this.temperature);
    });
  }

  // Hàm điều khiển bật/tắt bình nóng lạnh
  async controlDevicePower(value) {
    try {
      const response = await request.post({
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantID}/switch`,
        headers: {
          'ar.authToken': this.token,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        json: true,
        body: { state: value }, // Trạng thái bật hoặc tắt
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false,
      });

      if (response.statusCode === 200) {
        this.log("Successfully changed power state to: " + value);
      } else {
        throw new Error(`Failed to change power state: ${response.statusCode}`);
      }
    } catch (error) {
      this.log("Error controlling power state: " + error);
    }
  }
}
