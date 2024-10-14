const request = require("requestretry");

let hap;

module.exports = function(api) {
  hap = api.hap;
  api.registerAccessory("homebridge-aristonnet", "AristonNet", AristonWaterHeater);
}

class AristonWaterHeater {
  constructor(log, config, api) {
    try {
      this.log = log;

      this.name = config['name'];
      this.username = config['username'] || '';
      this.password = config['password'] || '';
      this.plantID = config['plantID'] || '';
      this.model = config['model'] || 'VELIS Tech Dry';
      this.serial_number = config['serial_number'] || '123456789';

      this.interval = 600; // Update interval in seconds
      this.temperature = 10; // Initial temperature value
      this.token = ''; // Token lưu trữ sau khi đăng nhập

      // Initialize accessory information service
      this.informationService = new hap.Service.AccessoryInformation();
      this.informationService
        .setCharacteristic(hap.Characteristic.Name, this.name)
        .setCharacteristic(hap.Characteristic.Manufacturer, 'Ariston')
        .setCharacteristic(hap.Characteristic.Model, this.model)
        .setCharacteristic(hap.Characteristic.SerialNumber, this.serial_number);

      // Initialize thermostat service
      this.thermostatService = new hap.Service.Thermostat(this.name);
      this.thermostatService
        .getCharacteristic(hap.Characteristic.CurrentTemperature)
        .onGet(this.getCurrentTemperature.bind(this));

      // Bật/tắt thiết bị
      this.thermostatService
        .getCharacteristic(hap.Characteristic.On)
        .onSet(this.setPowerState.bind(this))
        .onGet(this.getPowerState.bind(this));

      // Start data update cycle
      this.updateDeviceData();
      setInterval(this.updateDeviceData.bind(this), this.interval * 1000);
    } catch (error) {
      this.log('Error initializing module: ' + error);
    }
  }

  // Lấy danh sách các service của thiết bị
  getServices() {
    return [this.informationService, this.thermostatService];
  }

  // Lấy nhiệt độ hiện tại
  getCurrentTemperature() {
    this.log('Getting current temperature: ' + this.temperature);
    return this.temperature;
  }

  // Lấy trạng thái bật/tắt thiết bị
  getPowerState() {
    this.log('Getting power state...');
    return this.powerState || false; // Mặc định là tắt nếu không xác định
  }

  // Thiết lập trạng thái bật/tắt
  async setPowerState(state) {
    try {
      this.log('Setting power state to: ' + state);
      await this.updateToken(); // Cập nhật token nếu cần

      const response = await request({
        method: 'POST',
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantID}/switch`,
        headers: {
          'ar.authToken': this.token,
          'Accept': 'application/json, text/json, text/x-json, text/javascript, application/xml, text/xml',
          'User-Agent': 'RestSharp/106.11.7.0',
          'Host': 'www.ariston-net.remotethermo.com',
          'Content-Type': 'application/json'
        },
        json: true,
        body: state ? 'true' : 'false'
      });

      if (response.statusCode === 200) {
        this.powerState = state;
        this.log('Power state successfully updated to: ' + state);
      } else {
        throw new Error(`Failed to change power state: ${response.statusCode}`);
      }
    } catch (error) {
      this.log('Error controlling power state: ' + error);
    }
  }

  // Cập nhật dữ liệu thiết bị
  async updateDeviceData() {
    try {
      this.log('Updating temperature data...');
      await this.updateToken(); // Cập nhật token nếu cần
      await this.getTemperatureAPI();
    } catch (error) {
      this.log('Error updating temperature: ' + error);
    }
  }

  // Cập nhật token đăng nhập
  async updateToken() {
    if (this.token) {
      this.log('Token already available. Skipping login.');
      return;
    }
    await this.login();
  }

  // Đăng nhập và lấy token
  async login() {
    try {
      this.log('Logging in with username: ' + this.username);

      const response = await request({
        method: 'POST',
        url: 'https://www.ariston-net.remotethermo.com/api/v2/accounts/login',
        headers: {
          'Accept': 'application/json, text/json, text/x-json, text/javascript, application/xml, text/xml',
          'User-Agent': 'RestSharp/106.11.7.0',
          'Host': 'www.ariston-net.remotethermo.com',
          'Content-Type': 'application/json'
        },
        json: true,
        body: {
          usr: this.username,
          pwd: this.password,
          imp: false,
          notTrack: true,
          appInfo: {
            os: 2,
            appVer: '5.6.7772.40151',
            appId: 'com.remotethermo.aristonnet'
          }
        },
        maxAttempts: 3, // Thử lại nếu gặp lỗi
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false
      });

      if (response.statusCode === 200) {
        this.token = response.body.authToken; // Lưu authToken từ API
        this.log('Login successful. Token: ' + this.token);
      } else {
        throw new Error(`Login failed with status: ${response.statusCode}`);
      }
    } catch (error) {
      this.log('Login error: ' + (error.response ? JSON.stringify(error.response.body) : error.message));
    }
  }

  // Helper function to get temperature from the API
  async getTemperatureAPI() {
    try {
      this.log('Fetching temperature data for plantID: ' + this.plantID);

      const response = await request({
        method: 'GET',
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/plantData/${this.plantID}`,
        headers: {
          'ar.authToken': this.token,
          'Accept': 'application/json, text/json, text/x-json, text/javascript, application/xml, text/xml',
          'User-Agent': 'RestSharp/106.11.7.0',
          'Host': 'www.ariston-net.remotethermo.com',
        },
        json: true
      });

      if (response.statusCode === 200) {
        this.temperature = response.body.temp || 10; // Cập nhật nhiệt độ
        this.log('Successfully updated temperature: ' + this.temperature);
      } else {
        this.log('Error fetching temperature data: ' + response.statusCode);
      }
    } catch (error) {
      this.log('Error in API request: ' + error);
    }
  }
}
