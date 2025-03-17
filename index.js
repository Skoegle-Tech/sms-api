const express = require("express");
const mqtt = require("mqtt");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const MQTT_BROKER = "broker.emqx.io"; 
const MQTT_PORT = 1883; 

const mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER}:${MQTT_PORT}`);

const pendingRequests = new Map();

mqttClient.on("connect", () => {
    console.log("✅ Connected to Local MQTT Broker");

    mqttClient.subscribe("update/+/alert", (err) => {
        if (err) {
            console.error("❌ Failed to subscribe to update alerts", err);
        } else {
            console.log("📡 Listening for update alerts...");
        }
    });
});

mqttClient.on("error", (err) => {
    console.error("❌ MQTT Connection Error:", err);
});

mqttClient.on("message", (topic, message) => {
    console.log("--------------------");
    console.log(topic, message.toString());
    console.log("--------------------");
    
    const topicParts = topic.split('/');
    if (topicParts.length === 3) {
        const apikey = topicParts[1];
        const messageStr = message.toString();
        
        if (messageStr === 'SUCCESS' && pendingRequests.has(apikey)) {
            const { res, timer, number, originalMessage } = pendingRequests.get(apikey);
            
            clearTimeout(timer);
      
            res.json({ 
                success: true, 
                message: `SMS sent successfully to ${number}`, 
                originalMessage: originalMessage 
            });
            
    
            pendingRequests.delete(apikey);
        }
    }
});

app.get("/sendsms", (req, res) => {
    const { number, message, apikey } = req.query;
    
    if (!number || !message || !apikey) {
        return res.status(400).json({ error: "number, message, apikey are required" });
    }
    
    const userTopic = `update/${apikey}/alert`;
    const timeoutDuration = 30000; 
    const timer = setTimeout(() => {
        if (pendingRequests.has(apikey)) {
            pendingRequests.get(apikey).res.status(504).json({ 
                success: false, 
                error: "Timeout waiting for SMS confirmation" 
            });
            pendingRequests.delete(apikey);
        }
    }, timeoutDuration);
    
    pendingRequests.set(apikey, {
        res,
        timer,
        number,
        originalMessage: message,
        timestamp: Date.now()
    });

    mqttClient.publish(userTopic, `${number} | ${message}`, { qos: 0, retain: false }, (err) => {
        if (err) {
            clearTimeout(timer);
            pendingRequests.delete(apikey);
            return res.status(500).json({ success: false, error: "Failed to send update" });
        }
        console.log(`Message published to ${userTopic}: ${number} | ${message}`);
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [apikey, request] of pendingRequests.entries()) {
   
        
        if (now - request.timestamp > 300000) {
            clearTimeout(request.timer);
            pendingRequests.delete(apikey);
            console.log(`Cleaned up stale request for apikey: ${apikey}`);
        }
    }
}, 60000); 

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Express Server running on port ${PORT}`);
});