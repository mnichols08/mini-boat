const { MongoClient } = require("mongodb");

class RunStore {
  constructor(uri = process.env.MONGODB_URI) {
    this.uri = uri;
    this.client = null;
    this.collection = null;
    this.disabled = !uri;
  }

  async connect() {
    if (this.disabled || this.collection) {
      return;
    }
    try {
      this.client = new MongoClient(this.uri, {
        serverSelectionTimeoutMS: 2500,
      });
      await this.client.connect();
      this.collection = this.client.db().collection("runs");
      console.log("MongoDB run persistence connected.");
    } catch (error) {
      this.disabled = true;
      console.warn(
        "MongoDB unavailable; completed runs will not be stored.",
        error.message,
      );
    }
  }

  async saveRun(run) {
    if (this.disabled) {
      return false;
    }
    try {
      await this.connect();
      if (!this.collection) {
        return false;
      }
      await this.collection.insertOne({ completedAt: new Date(), ...run });
      return true;
    } catch (error) {
      this.disabled = true;
      console.warn(
        "Failed to store completed run; continuing without persistence.",
        error.message,
      );
      return false;
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
    }
  }
}

module.exports = {
  RunStore,
};
