require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.psjt8aa.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("SkyTower").collection("users");
    const apartmentsCollection = client.db("SkyTower").collection("apartments");
    const agreementsCollection = client.db("SkyTower").collection("agreements");
    const couponsCollection = client.db("SkyTower").collection("coupons");
    const announcementsCollection = client
      .db("SkyTower")
      .collection("announcements");

    // users

    // app.get("/users", async (req, res) => {
    //   const email = req.query.email;

    //   if (email) {
    //     const user = await usersCollection.findOne({ email: email });
    //     res.send(user);
    //   } else {
    //     const users = await usersCollection.find().toArray();
    //     res.send(users);
    //   }
    // });

    app.get("/users", async (req, res) => {
      const { email, role } = req.query;

      const filter = {};
      if (email) filter.email = email;
      if (role) filter.role = role;

      try {
        const users = await usersCollection.find(filter).toArray();
        // If specific email is queried and only one result is expected
        if (email && !role) {
          return res.send(users[0] || null);
        }
        res.send(users);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      if (!user.email) {
        return res.status(400).json({ message: "Email is required" });
      }
      // Check if user already exists
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) {
        return res
          .status(200)
          .json({ message: "User already exists", user: existing });
      }
      // Insert new user
      const result = await usersCollection.insertOne(user);
      res
        .status(201)
        .json({ message: "User created", insertedId: result.insertedId });
    });

    app.patch("/users", async (req, res) => {
      const email = req.query.email;
      const updateDoc = {
        $set: {
          role: req.body.role, // expected: 'user'
        },
      };
      const result = await usersCollection.updateOne({ email }, updateDoc);
      res.send(result);
    });

    // Apartments
    app.get("/apartments", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 6;
      const skip = (page - 1) * limit;

      const minRent = parseInt(req.query.minRent) || 0;
      const maxRent = parseInt(req.query.maxRent) || Infinity;

      const query = {
        rent: { $gte: minRent, $lte: maxRent },
      };

      try {
        const total = await apartmentsCollection.countDocuments(query);
        const apartments = await apartmentsCollection
          .find(query)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          apartments,
        });
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch apartments" });
      }
    });

    // agreements
    app.get("/agreements", async (req, res) => {
      try {
        const { email } = req.query;
        let query = {};
        if (email) query.userEmail = email;

        const agreements = await agreementsCollection.find(query).toArray();
        res.send(agreements);
      } catch (error) {
        console.error("Error fetching agreements:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/member-agreements", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        // Check user role by email
        const user = await usersCollection.findOne({ email });

        if (!user || user.role !== "member") {
          return res
            .status(403)
            .send({ message: "Access denied. Only members allowed." });
        }

        // Get agreements for the user
        const agreements = await agreementsCollection
          .findOne({ userEmail: email });

        res.send(agreements);
      } catch (error) {
        console.error("Error fetching member agreements:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.post("/agreements", async (req, res) => {
      try {
        const agreement = req.body;

        if (
          !agreement.userEmail ||
          !agreement.apartmentNo ||
          !agreement.floor ||
          !agreement.block ||
          !agreement.rent
        ) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        const { userEmail } = req.body;
        const existing = await agreementsCollection.findOne({ userEmail });

        if (existing) {
          return res
            .status(400)
            .json({ message: "User already has an agreement." });
        }

        agreement.createdAt = new Date();
        const result = await agreementsCollection.insertOne(agreement);
        res.send(result);
      } catch (error) {
        console.error("Error adding agreement:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // PATCH: Accept agreement & update role
    app.patch("/agreements/:id/accept", async (req, res) => {
      const id = req.params.id;
      const agreementFilter = { _id: new ObjectId(id) };
      const agreementUpdate = { $set: { status: "checked" } };

      const agreementResult = await agreementsCollection.updateOne(
        agreementFilter,
        agreementUpdate
      );

      const { email } = req.body;
      const userFilter = { email };
      const roleUpdate = { $set: { role: "member" } };

      const userResult = await usersCollection.updateOne(
        userFilter,
        roleUpdate
      );

      res.send({ agreementResult, userResult });
    });

    // PATCH: Reject agreement (no role change)
    app.patch("/agreements/:id/reject", async (req, res) => {
      const id = req.params.id;
      const agreementFilter = { _id: new ObjectId(id) };
      const agreementUpdate = { $set: { status: "checked" } };

      const result = await agreementsCollection.updateOne(
        agreementFilter,
        agreementUpdate
      );
      res.send(result);
    });

    // Announcements
    app.get("/announcements", async (req, res) => {
      const result = await announcementsCollection.find().toArray();
      res.send(result);
    });

    app.post("/announcements", async (req, res) => {
      try {
        const { title, description, importance, type } = req.body;

        const newAnnouncement = {
          title,
          description,
          importance,
          type,
          createdAt: new Date(),
        };

        const result = await announcementsCollection.insertOne(newAnnouncement);
        res.status(201).json({ message: "Announcement created successfully" });
      } catch (error) {
        res.status(500).json({ error: "Failed to create announcement" });
      }
    });

    // coupons

    app.get("/coupons", async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (error) {
        console.error("Failed to fetch coupons:", error);
        res
          .status(500)
          .send({ message: "Server error while fetching coupons" });
      }
    });

    app.post("/coupons", async (req, res) => {
      try {
        const coupon = req.body;
        const result = await couponsCollection.insertOne(coupon);
        res.status(201).send(result);
      } catch (error) {
        console.error("Failed to add coupon:", error);
        res.status(500).send({ message: "Server error while adding coupon" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello SkyTower!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
