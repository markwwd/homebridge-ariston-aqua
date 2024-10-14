const axios = require('axios');
let Accessory, Service, Characteristic, UUIDGen;

module.exports = (homebridge) => {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerAccessory('homebridge-aristonnet', 'AristonWaterHeater', AristonWaterHeater);
};

class AristonWaterHeater {
  constructor(log, config) {
    this.log = log;
    this.name = config.name || 'Ariston Heater';
    this.username = config.username;
    this.password = config.password;
    this.plantId = config.plantId;
    this.token = null;
    this.powerState = false; // Lưu trạng thái bật/tắt

    this.heaterService = new Service.Thermostat(this.name);

    this.heaterService
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({
        minValue: 30,
        maxValue: 100,
        minStep: 1
      })
      .on('set', this.setTargetTemperature.bind(this));

    this.heaterService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));

    this.heaterService
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .on('get', this.getHeatingState.bind(this));

    this.heaterService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT] // Chỉ hiển thị OFF và HEAT
      })
      .on('set', this.setHeatingState.bind(this));

    this.login();
  }

  // Phương thức đăng nhập và lấy token
  async login() {
    try {
      const response = await axios.post('https://www.ariston-net.remotethermo.com/api/v2/accounts/login', {
        usr: this.username,
        pwd: this.password,
        imp: false,
        notTrack: true,
        appInfo: {
          os: 2,
          appVer: '5.6.7772.40151',
          appId: 'com.remotethermo.aristonnet',
        },
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      this.token = response.data.token;
      this.log('Login successful, token received:', this.token);
    } catch (error) {
      this.log('Error logging in:', error);
    }
  }

  // Lấy nhiệt độ hiện tại
  async getCurrentTemperature(callback) {
    if (!this.token) {
      callback(null, 30); // Mặc định là 30 nếu không có token
      return;
    }

    try {
      const response = await axios.get(`https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantId}`, {
        headers: {
          'ar.authToken': this.token,
        },
      });

      let currentTemperature = response.data.temp;

      if (typeof currentTemperature !== 'number' || !isFinite(currentTemperature)) {
        this.log('Current temperature is invalid, defaulting to 30°C');
        currentTemperature = 30; // Mặc định là 30°C nếu không hợp lệ
      }

      this.log('Current temperature:', currentTemperature);
      callback(null, currentTemperature);
    } catch (error) {
      this.log('Error getting current temperature:', error);
      callback(null, 30); // Mặc định là 30°C nếu lỗi
    }
  }

  // Đặt nhiệt độ mong muốn
  async setTargetTemperature(value, callback) {
    if (!this.token) {
      this.log('No token, cannot set temperature');
      callback(new Error('No token'));
      return;
    }

    value = Math.max(30, Math.min(value, 100)); // Giới hạn nhiệt độ từ 30 đến 100

    try {
      const response = await axios.post(`https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantId}/temperature`, {
        eco: false,
        new: value,
        old: 70,  // Cần lấy giá trị cũ từ hệ thống nếu cần
      }, {
        headers: {
          'ar.authToken': this.token,
          'Content-Type': 'application/json',
        },
      });

      if (response.data.success) {
        this.log(`Target temperature set to ${value}°C`);
        callback(null);
      } else {
        this.log('Error setting target temperature');
        callback(new Error('Failed to set target temperature'));
      }
    } catch (error) {
      this.log('Error setting temperature:', error);
      callback(error);
    }
  }

  // Bật/tắt máy sưởi
  async setHeatingState(value, callback) {
    if (!this.token) {
      callback(new Error('No token'));
      return;
    }

    // Chỉ cho phép bật (HEAT) hoặc tắt (OFF)
    const powerState = value === Characteristic.TargetHeatingCoolingState.HEAT;
    this.powerState = powerState; // Cập nhật trạng thái bật/tắt
    this.log(powerState ? 'Turning heater ON' : 'Turning heater OFF');

    try {
      const response = await axios.post(`https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantId}/switch`, powerState, {
        headers: {
          'ar.authToken': this.token,
          'Content-Type': 'application/json',
        },
      });

      if (response.data.success) {
        this.log('Heater state updated successfully');
        callback(null);
      } else {
        this.log('Error updating heater state');
        callback(new Error('Failed to update heater state'));
      }
    } catch (error) {
      this.log('Error updating heater state:', error);
      callback(error);
    }
  }

  // Lấy trạng thái bật/tắt của máy sưởi
  getHeatingState(callback) {
    if (this.powerState) {
      // Nếu máy sưởi bật, trả về HEAT
      callback(null, Characteristic.CurrentHeatingCoolingState.HEAT);
    } else {
      // Nếu máy sưởi tắt, trả về OFF
      callback(null, Characteristic.CurrentHeatingCoolingState.OFF);
    }
  }

  getServices() {
    return [this.heaterService];
  }
}
