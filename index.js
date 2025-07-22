require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require('mongodb');

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
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db('SkyTower').collection('users');


    // users 

    app.get('/users', async (req, res) => {
      const email = req.query.email;

      if (email) {
        const user = await usersCollection.findOne({ email: email });
        // if (user) {
        //   res.send(user);
        // } else {
        //   res.status(404).send({ message: 'User not found' });
        // }
        res.send(user)
      } else {
        const users = await usersCollection.find().toArray();
        res.send(users);
      }
    });

    app.post('/users' , async(req , res)=>{
      const user = req.body;
      if (!user.email) {
        return res.status(400).json({ message: 'Email is required' });
      }
      // Check if user already exists
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) {
        return res.status(200).json({ message: 'User already exists', user: existing });
      }
      // Insert new user
      const result = await usersCollection.insertOne(user);
      res.status(201).json({ message: 'User created', insertedId: result.insertedId });
    })




    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('Hello SkyTower!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
