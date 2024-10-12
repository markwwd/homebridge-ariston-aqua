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
    this.temperature = 10; // Nhiệt độ khởi tạo (tạm thời) sẽ được cập nhật từ thiết bị
    this.powerState = false; // Trạng thái bật/tắt khởi tạo sẽ lấy từ API
    this.token = null; // Token cho API

    // Khởi tạo thông tin thiết bị
    this.informationService = new hap.Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(hap.Characteristic.Name, this.model)
      .setCharacteristic(hap.Characteristic.Manufacturer, "Ariston")
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial_number);

    // Khởi tạo dịch vụ điều khiển nhiệt độ
    this.thermostatService = new hap.Service.Thermostat(this.model);

    // Chỉ cho phép chế độ "HEAT" khi bật
    this.thermostatService
      .getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [hap.Characteristic.TargetHeatingCoolingState.OFF, hap.Characteristic.TargetHeatingCoolingState.HEAT] // Cho phép bật là HEAT và tắt
      })
      .onGet(this.getCurrentHeatingCoolingState.bind(this)) // Lấy trạng thái bật/tắt hiện tại của thiết bị
      .onSet(this.setHeatingCoolingState.bind(this)); // Cài đặt trạng thái

    // Lấy nhiệt độ hiện tại của thiết bị
    this.thermostatService
      .getCharacteristic(hap.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    // Điều chỉnh nhiệt độ với giá trị hợp lệ (tối thiểu là 10)
    this.thermostatService
      .getCharacteristic(hap.Characteristic.TargetTemperature)
      .setProps({
        minValue: 10, // Đặt giá trị tối thiểu là 10
        maxValue: 65, // Đặt giá trị tối đa là 65
      })
      .onGet(this.getCurrentTemperature.bind(this)) // Lấy nhiệt độ hiện tại
      .onSet(this.setTemperature.bind(this)); // Cài đặt nhiệt độ

    // Đăng nhập vào API và lấy dữ liệu ban đầu
    this.loginToAPI();
  }

  // Cung cấp các dịch vụ
  getServices() {
    return [this.informationService, this.thermostatService];
  }

  // Trả về trạng thái hiện tại (bật là HEAT, tắt là OFF)
  getCurrentHeatingCoolingState() {
    return this.powerState ? hap.Characteristic.TargetHeatingCoolingState.HEAT : hap.Characteristic.TargetHeatingCoolingState.OFF;
  }

  // Đặt trạng thái bật/tắt thiết bị
  async setHeatingCoolingState(value) {
    const isPowerOn = value === hap.Characteristic.TargetHeatingCoolingState.HEAT;
    this.powerState = isPowerOn;
    this.log("Setting power state to: " + (isPowerOn ? "HEAT" : "OFF"));
    await this.controlDevicePower(isPowerOn);
  }

  // Trả về nhiệt độ hiện tại của thiết bị
  getCurrentTemperature() {
    return this.temperature;
  }

  // Đặt nhiệt độ mới
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

  // Đăng nhập vào API và lấy trạng thái khởi tạo
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
        this.log("Error logging in: " + err || resp.statusCode);
        return;
      }
      
      this.token = body.token; // Lưu token
      this.log("Successfully logged in. Token: " + this.token);
      
      // Lấy thông tin ban đầu từ thiết bị
      this.updateDeviceData();
      setInterval(this.updateDeviceData.bind(this), this.interval * 1000);
    });
  }

  // Lấy trạng thái và nhiệt độ hiện tại từ API
  updateDeviceData() {
    this.log("Fetching current device data...");

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
        this.log("Error fetching device data: " + err || resp.statusCode);
        return;
      }

      // Cập nhật nhiệt độ và trạng thái bật/tắt
      this.temperature = body.temp || 10; // Đảm bảo nhiệt độ không dưới 10
      this.powerState = body.powerState || false; // Cập nhật trạng thái bật/tắt
      this.log("Success updating temperature: " + this.temperature + ", Power State: " + (this.powerState ? "On" : "Off"));
    });
  }

  // Điều khiển trạng thái bật/tắt thiết bị
  async controlDevicePower(isPowerOn) {
    try {
      const response = await request.post({
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantID}/switch`,
        headers: {
          'ar.authToken': this.token,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        json: true,
        body: { state: isPowerOn }, // Trạng thái bật hoặc tắt
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false,
      });

      if (response.statusCode === 200) {
        this.log("Successfully changed power state to: " + (isPowerOn ? "On" : "Off"));
      } else {
        throw new Error(`Failed to change power state: ${response.statusCode}`);
      }
    } catch (error) {
      this.log("Error controlling power state: " + error);
    }
  }
}
