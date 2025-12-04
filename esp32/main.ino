#define SIMULATION true

if(SIMULATION){
   distanceSlots[i] = random(10,200); 
}
else{
   distanceSlots[i] = getDistance(trigPins[i], echoPins[i]);
}
