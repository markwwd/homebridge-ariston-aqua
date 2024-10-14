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
      this.name = config["name"];
      this.username = config["username"] || "";
      this.password = config["password"] || "";
      this.plantID = config["plantID"] || "";
      this.model = config["model"] || "VELIS Tech Dry";
      this.serial_number = config["serial_number"] || "123456789";

      this.authToken = null;
      this.interval = 600;
      this.temperature = 0;

      this.informationService = new hap.Service.AccessoryInformation();
      this.informationService
        .setCharacteristic(hap.Characteristic.Name, this.name)
        .setCharacteristic(hap.Characteristic.Manufacturer, "Ariston")
        .setCharacteristic(hap.Characteristic.Model, this.model)
        .setCharacteristic(hap.Characteristic.SerialNumber, this.serial_number);

      this.thermostatService = new hap.Service.Thermostat(this.name);
      this.thermostatService
        .getCharacteristic(hap.Characteristic.CurrentTemperature)
        .onGet(this.getCurrentTemperature.bind(this));
        
      this.thermostatService
        .getCharacteristic(hap.Characteristic.TargetTemperature)
        .onSet(this.setTargetTemperature.bind(this));

      this.login(); // Log in on initialization
      this.updateDeviceData();
      setInterval(this.updateDeviceData.bind(this), this.interval * 1000);
    }
    catch (error) {
      this.log("Error initializing module: " + error);
    }
  }

  getServices() {
    return [this.informationService, this.thermostatService];
  }

  getCurrentTemperature() {
    return this.temperature;
  }

  async setTargetTemperature(value) {
    try {
      if (!this.authToken) {
        this.log("Not authenticated. Cannot set temperature.");
        return;
      }
      this.log("Setting new temperature to: " + value);
      const response = await this.setTemperatureAPI(value);
      if (response && response.success) {
        this.log("Temperature successfully updated to " + value);
      } else {
        this.log("Failed to update temperature.");
      }
    } catch (error) {
      this.log("Error setting temperature: " + error);
    }
  }

  async login() {
    try {
      // Prepare the request body and headers
      const requestBody = JSON.stringify({
        usr: this.username,
        pwd: this.password,
        imp: false,
        notTrack: true,
        appInfo: { os: 2, appVer: "5.6.7772.40151", appId: "com.remotethermo.aristonnet" }
      });
  
      const requestHeaders = {
        "Accept": "application/json, text/json, text/x-json, text/javascript, application/xml, text/xml",
        "User-Agent": "RestSharp/106.11.7.0",
        "Host": "www.ariston-net.remotethermo.com",
        "Content-Type": "application/json"
      };
  
      // Log the full request details (headers and body)
      this.log("Request Body: ", requestBody);
      this.log("Request Headers: ", requestHeaders);
  
      // Send the request and log the response
      const response = await request.post({
        url: "https://www.ariston-net.remotethermo.com/api/v2/accounts/login",
        body: requestBody,
        headers: requestHeaders,
        json: true,
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false
      });
  
      // Log the full response for further debugging
      this.log("Full login response:", response);
  
      if (response && response.body) {
        this.authToken = response.body.authToken; // Store auth token
        this.log("Login successful. Auth Token: " + this.authToken);
      } else {
        this.log("Login failed. Response: ", response);
      }
    } catch (error) {
      this.log("Login error: " + error);
    }
  }
  
  

  async updateDeviceData() {
    try {
      this.log("Updating temperature...");
      const response = await this.getTemperatureAPI();
      if (response && response.success) {
        this.temperature = response.temp;
        this.log("Current temperature updated to " + this.temperature);
      } else {
        this.log("Failed to update temperature.");
      }
    } catch (error) {
      this.log("Error updating temperature: " + error);
    }
  }

  async getTemperatureAPI() {
    try {
      if (!this.authToken) {
        this.log("Not authenticated. Cannot get temperature.");
        return;
      }
      const response = await request({
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/plantData/${this.plantID}`,
        headers: {
          "ar.authToken": this.authToken,
          "Accept": "application/json",
          "User-Agent": "RestSharp/106.11.7.0"
        },
        json: true,
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false
      });

      return response.body;
    } catch (error) {
      this.log("Error retrieving temperature: " + error);
    }
  }

  async setTemperatureAPI(newTemp) {
    try {
      if (!this.authToken) {
        this.log("Not authenticated. Cannot set temperature.");
        return;
      }

      const response = await request.post({
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantID}/temperature`,
        headers: {
          "ar.authToken": this.authToken,
          "Accept": "application/json",
          "Content-Type": "application/json",
          "User-Agent": "RestSharp/106.11.7.0"
        },
        body: JSON.stringify({
          eco: false,
          new: newTemp,
          old: this.temperature
        }),
        json: true,
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false
      });

      return response.body;
    } catch (error) {
      this.log("Error setting temperature: " + error);
    }
  }

  async switchDeviceOnOff(state) {
    try {
      if (!this.authToken) {
        this.log("Not authenticated. Cannot switch device.");
        return;
      }

      this.log("Switching device to " + (state ? "ON" : "OFF"));
      const response = await request.post({
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantID}/switch`,
        headers: {
          "ar.authToken": this.authToken,
          "Accept": "application/json",
          "Content-Type": "application/json",
          "User-Agent": "RestSharp/106.11.7.0"
        },
        body: JSON.stringify(state),
        json: true,
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false
      });

      return response.body;
    } catch (error) {
      this.log("Error switching device: " + error);
    }
  }
}

